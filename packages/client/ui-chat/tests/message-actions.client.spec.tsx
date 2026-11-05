// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { AttachmentId, type FileAttachmentRef, type ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { ChatConversationViewNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { ChatNodeViewProps, UserContentAttachment } from '../src/client/contract/slots.ts'
import { MessageEditor } from '../src/client/chat/MessageEditor.tsx'
import { MessageIconActions } from '../src/client/chat/MessageIconActions.tsx'
import { UserMessageNodeView } from '../src/client/chat/MessageItem.tsx'
import { en, zh } from '../src/client/locale.ts'

afterEach(cleanup)

const enT = makeTranslate(en, commonEn)
const zhT = makeTranslate(zh, commonZh)

const image: ImageAttachmentRef = {
  attachmentId: AttachmentId(`sha256:${'a'.repeat(64)}`),
  mediaType: 'image/png', bytes: 68, width: 640, height: 320, name: 'history.png',
}
const note: FileAttachmentRef = {
  attachmentId: AttachmentId(`sha256:${'b'.repeat(64)}`), name: 'notes.txt', bytes: 23,
}
const imagePart: UserContentAttachment = { type: 'image', image: { attachment: image } }
const filePart: UserContentAttachment = { type: 'file', file: note }
const unnamedImage: UserContentAttachment = { type: 'image', image: { preview: { url: 'blob:local' } } }

describe('message icon actions', () => {
  it('places retract and edit after copy and invokes each handler', () => {
    const onRetract = vi.fn()
    const onEdit = vi.fn()
    const view = render(
      <MessageIconActions text="Hello" clock="start" onRetract={onRetract} onEdit={onEdit} t={enT} />,
    )
    const buttons = view.getAllByRole('button')
    expect(buttons.map(button => button.getAttribute('aria-label'))).toEqual([
      'Copy', 'Retract to this message', 'Edit this message',
    ])
    fireEvent.click(buttons[1] as HTMLElement)
    fireEvent.click(buttons[2] as HTMLElement)
    expect(onRetract).toHaveBeenCalledTimes(1)
    expect(onEdit).toHaveBeenCalledTimes(1)
  })

  it('keeps the copy action alone when a row owns no message actions', () => {
    const view = render(<MessageIconActions text="Reply" clock="end" t={enT} />)
    expect(view.getAllByRole('button').map(button => button.getAttribute('aria-label'))).toEqual(['Copy'])
  })

  it('keeps message actions visible but inert while the session runs', () => {
    const onRetract = vi.fn()
    const onEdit = vi.fn()
    const view = render(
      <MessageIconActions
        text="Hello" clock="start" onRetract={onRetract} onEdit={onEdit}
        messageActionsUnavailable="running" t={enT}
      />,
    )
    for (const [label, reason] of [
      ['Retract to this message', 'Unavailable while the session is running'],
      ['Edit this message', 'Unavailable while the session is running'],
    ] as const) {
      const button = view.getByRole('button', { name: label })
      expect(button.getAttribute('aria-disabled')).toBe('true')
      expect(button.hasAttribute('data-unavailable')).toBe(true)
      const describedBy = button.getAttribute('aria-describedby')
      expect(describedBy).not.toBeNull()
      expect(document.getElementById(describedBy as string)?.textContent).toBe(reason)
      fireEvent.click(button)
    }
    expect(onRetract).not.toHaveBeenCalled()
    expect(onEdit).not.toHaveBeenCalled()
  })

  it('states unavailable actions in the active locale', () => {
    const view = render(
      <MessageIconActions text="你好" clock="start" onRetract={vi.fn()} onEdit={vi.fn()}
        messageActionsUnavailable="running" t={zhT} />,
    )
    const retract = view.getByRole('button', { name: '回退到这条消息' })
    expect(document.getElementById(retract.getAttribute('aria-describedby') as string)?.textContent)
      .toBe('会话运行中，暂不可回退')
    expect(view.container.textContent).toContain('会话运行中，暂不可编辑')
  })

  it('explains an offline connection instead of a running session', () => {
    const view = render(
      <MessageIconActions
        text="Hello" clock="start" onRetract={vi.fn()} onEdit={vi.fn()}
        messageActionsUnavailable="disconnected" t={enT}
      />,
    )
    for (const name of ['Retract to this message', 'Edit this message']) {
      const button = view.getByRole('button', { name })
      expect(button.getAttribute('aria-disabled')).toBe('true')
      expect(document.getElementById(button.getAttribute('aria-describedby') as string)?.textContent)
        .toBe('Unavailable while the connection is offline')
    }
  })
})

describe('message editor', () => {
  const editor = (props: Partial<Parameters<typeof MessageEditor>[0]> = {}) => render(
    <MessageEditor
      initialText="original text"
      attachments={[]}
      onSend={async () => true}
      onCancel={vi.fn()}
      t={enT}
      {...props}
    />,
  )

  it('prefills the message and focuses the editable text', () => {
    const view = editor()
    const textarea = view.getByRole('textbox', { name: 'Edit message text' })
    expect((textarea as HTMLTextAreaElement).value).toBe('original text')
    expect(document.activeElement).toBe(textarea)
  })

  it('shows attachments, references, and skills as read-only chips', () => {
    const view = editor({
      attachments: [filePart, imagePart, unnamedImage],
      referenceLabels: ['Session A'],
      skillNames: ['commit'],
    })
    const attachments = view.getByRole('group', { name: 'Attachments (read-only)' })
    expect(attachments.textContent).toContain('notes.txt')
    expect(attachments.textContent).toContain('history.png')
    // An image without a recorded name keeps a localized stand-in.
    expect(attachments.textContent).toContain('Image')
    expect(attachments.querySelectorAll('button')).toHaveLength(0)
    expect(view.getByRole('group', { name: 'References (read-only)' }).textContent).toBe('Session A')
    expect(view.getByRole('group', { name: 'Skills (read-only)' }).textContent).toBe('commit')
    expect(view.queryAllByRole('button').map(button => button.getAttribute('aria-label'))).toEqual([
      'Cancel editing', 'Send the edited message',
    ])
  })

  it('refuses to send an empty draft', () => {
    const onSend = vi.fn(async () => true)
    const view = editor({ initialText: '   ', onSend })
    const textarea = view.getByRole('textbox')
    const send = view.getByRole('button', { name: 'Send the edited message' })
    expect(send.getAttribute('aria-disabled')).toBe('true')
    fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true })
    fireEvent.click(send)
    expect(onSend).not.toHaveBeenCalled()
  })

  it.each([
    ['Control', { ctrlKey: true }],
    ['Meta', { metaKey: true }],
  ])('sends the edited text on %s + Enter', async (_label, modifier) => {
    const onSend = vi.fn(async () => true)
    const view = editor({ onSend })
    const textarea = view.getByRole('textbox')
    fireEvent.change(textarea, { target: { value: '  edited copy  ' } })
    fireEvent.keyDown(textarea, { key: 'Enter', ...modifier })
    await waitFor(() => { expect(onSend).toHaveBeenCalledWith('  edited copy  ') })
  })

  it('cancels on Escape without sending', () => {
    const onCancel = vi.fn()
    const onSend = vi.fn(async () => true)
    const view = editor({ onCancel, onSend })
    fireEvent.keyDown(view.getByRole('textbox'), { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onSend).not.toHaveBeenCalled()
  })

  it('keeps the draft and reports a rejected send in place', async () => {
    const view = editor({ onSend: async () => false })
    const textarea = view.getByRole('textbox')
    fireEvent.change(textarea, { target: { value: 'kept draft' } })
    fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true })
    await waitFor(() => {
      expect(view.getByRole('alert').textContent).toBe('Could not send the edit; your changes are kept')
    })
    expect((view.getByRole('textbox') as HTMLTextAreaElement).value).toBe('kept draft')
  })

  it('shows the sending state until the host rejects the edit', async () => {
    let settle: (accepted: boolean) => void = () => {}
    const onSend = vi.fn(() => new Promise<boolean>((resolve) => { settle = resolve }))
    const view = editor({ onSend })
    const root = view.container.querySelector('[data-message-editor]')
    fireEvent.change(view.getByRole('textbox'), { target: { value: 'edited' } })
    fireEvent.keyDown(view.getByRole('textbox'), { key: 'Enter', ctrlKey: true })
    expect(root?.getAttribute('aria-busy')).toBe('true')
    expect(view.getByRole('button', { name: 'Send the edited message' }).getAttribute('aria-disabled')).toBe('true')
    settle(false)
    await waitFor(() => { expect(root?.getAttribute('aria-busy')).toBeNull() })
    expect(view.getByRole('alert')).toBeTruthy()
  })

  it('keeps the sending state safe from a repeated shortcut', async () => {
    const onSend = vi.fn(() => new Promise<boolean>(() => {}))
    const view = editor({ onSend })
    fireEvent.change(view.getByRole('textbox'), { target: { value: 'edited' } })
    fireEvent.keyDown(view.getByRole('textbox'), { key: 'Enter', ctrlKey: true })
    fireEvent.keyDown(view.getByRole('textbox'), { key: 'Enter', ctrlKey: true })
    expect(onSend).toHaveBeenCalledTimes(1)
  })

  it('uses the active locale for its labels and hint', () => {
    const view = editor({ t: makeTranslate(zh) })
    expect(view.getByRole('textbox', { name: '编辑消息内容' })).toBeTruthy()
    expect(view.getByRole('button', { name: '发送修改后的消息' })).toBeTruthy()
    expect(view.getByRole('button', { name: '取消编辑' })).toBeTruthy()
    expect(view.container.textContent).toContain('Ctrl/⌘ + Enter 发送，Esc 取消')
  })
})

describe('user message row actions', () => {
  const idleSession: ChatNodeViewProps['useSession'] = bindSnapshotSelector({
    subscribe: () => () => {},
    getSnapshot: () => ({ running: false }),
  } as never)
  const runningSession: ChatNodeViewProps['useSession'] = bindSnapshotSelector({
    subscribe: () => () => {},
    getSnapshot: () => ({ running: true }),
  } as never)

  function rowNode(kind: 'user' | 'steering'): ChatConversationViewNode {
    return {
      key: `fixture:${kind}`,
      kind,
      id: '7',
      target: 'chat',
      anchorSeq: 7,
      location: { kind: 'session' },
      visibility: 'visible',
      data: {
        kind,
        seq: 7,
        time: 7_000,
        content: [{ type: 'text', text: 'hello there' }],
        source: null,
        ...(kind === 'steering' ? { messageId: 'fixture-message' } : {}),
      },
    }
  }

  const renderFactorySlot: ChatNodeViewProps['renderFactorySlot'] = () =>
    <span data-fixture-bubble="" />

  /** Chat-internal connection state the flow hands its rows. */
  type RowOverrides = Partial<Omit<ChatNodeViewProps, 'node'>> & { readonly disconnected?: boolean }

  function rowProps(
    kind: 'user' | 'steering',
    overrides: RowOverrides = {},
  ): ChatNodeViewProps<'user' | 'steering'> & { disconnected?: boolean } {
    const props: RowOverrides & { node: ChatConversationViewNode } = {
      node: rowNode(kind),
      t: enT,
      loadImage: async () => 'blob:image',
      renderFactorySlot,
      openFile: vi.fn(),
      useSession: idleSession,
      retractMessage: async () => ({ ok: true }),
      editMessage: async () => true,
      ...overrides,
    }
    return props as ChatNodeViewProps<'user' | 'steering'> & { disconnected?: boolean }
  }

  it('retracts the durable message at its own sequence', () => {
    const retractMessage = vi.fn(async () => ({ ok: true } as const))
    const view = render(
      <UserMessageNodeView {...rowProps('user', { retractMessage })} renderSlotChain={() => null} />,
    )
    fireEvent.click(view.getByRole('button', { name: 'Retract to this message' }))
    expect(retractMessage).toHaveBeenCalledTimes(1)
    expect(retractMessage).toHaveBeenCalledWith(7)
  })

  it('offers no retract or edit on a steering row', () => {
    const view = render(
      <UserMessageNodeView {...rowProps('steering')} renderSlotChain={() => null} />,
    )
    expect(view.queryByRole('button', { name: 'Retract to this message' })).toBeNull()
    expect(view.queryByRole('button', { name: 'Edit this message' })).toBeNull()
    expect(view.getByRole('button', { name: 'Copy' })).toBeTruthy()
  })

  it('disables retract and edit while the session runs', () => {
    const view = render(
      <UserMessageNodeView {...rowProps('user', { useSession: runningSession })} renderSlotChain={() => null} />,
    )
    for (const name of ['Retract to this message', 'Edit this message']) {
      expect(view.getByRole('button', { name }).getAttribute('aria-disabled')).toBe('true')
    }
    expect(view.container.textContent).toContain('Unavailable while the session is running')
  })

  it('treats an offline connection as unavailable and says so', () => {
    const view = render(
      <UserMessageNodeView {...rowProps('user', { disconnected: true })} renderSlotChain={() => null} />,
    )
    for (const name of ['Retract to this message', 'Edit this message']) {
      const button = view.getByRole('button', { name })
      expect(button.getAttribute('aria-disabled')).toBe('true')
      expect(document.getElementById(button.getAttribute('aria-describedby') as string)?.textContent)
        .toBe('Unavailable while the connection is offline')
    }
  })

  it('turns the bubble into the prefilled editor and closes it on an accepted edit', async () => {
    const editMessage = vi.fn(async () => true)
    const view = render(
      <UserMessageNodeView {...rowProps('user', { editMessage })} renderSlotChain={() => null} />,
    )
    fireEvent.click(view.getByRole('button', { name: 'Edit this message' }))
    const textarea = view.getByRole('textbox', { name: 'Edit message text' })
    expect((textarea as HTMLTextAreaElement).value).toBe('hello there')
    fireEvent.change(textarea, { target: { value: 'revised text' } })
    fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true })
    await waitFor(() => { expect(editMessage).toHaveBeenCalledWith(7, 'revised text') })
    await waitFor(() => { expect(view.queryByRole('textbox')).toBeNull() })
    expect(view.getByRole('button', { name: 'Edit this message' })).toBeTruthy()
  })

  it('keeps the editor and draft after a rejected edit while the message stays intact', async () => {
    const view = render(
      <UserMessageNodeView {...rowProps('user', { editMessage: async () => false })} renderSlotChain={() => null} />,
    )
    fireEvent.click(view.getByRole('button', { name: 'Edit this message' }))
    const textarea = view.getByRole('textbox')
    fireEvent.change(textarea, { target: { value: 'kept draft' } })
    fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true })
    await waitFor(() => {
      expect(view.getByRole('alert').textContent).toBe('Could not send the edit; your changes are kept')
    })
    // The draft survives; the failed edit did not consume it.
    expect((view.getByRole('textbox') as HTMLTextAreaElement).value).toBe('kept draft')
    // Cancelling restores the message the host never changed.
    fireEvent.keyDown(view.getByRole('textbox'), { key: 'Escape' })
    expect(view.queryByRole('textbox')).toBeNull()
    fireEvent.click(view.getByRole('button', { name: 'Edit this message' }))
    expect((view.getByRole('textbox') as HTMLTextAreaElement).value).toBe('hello there')
  })

  it('restores the bubble and returns focus to the edit action when cancelled', () => {
    const view = render(
      <UserMessageNodeView {...rowProps('user')} renderSlotChain={() => null} />,
    )
    const edit = view.getByRole('button', { name: 'Edit this message' })
    edit.focus()
    fireEvent.click(edit)
    fireEvent.keyDown(view.getByRole('textbox'), { key: 'Escape' })
    expect(view.queryByRole('textbox')).toBeNull()
    expect(document.activeElement).toBe(view.getByRole('button', { name: 'Edit this message' }))
  })
})
