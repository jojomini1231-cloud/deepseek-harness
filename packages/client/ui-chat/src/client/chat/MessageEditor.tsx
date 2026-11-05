/** In-place editor for one user message: read-only attachment and reference
 * chips, the editable text, and explicit send/cancel controls. */

import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import {
  FileTypeIcon, IconCheckOutlineRegular, IconCloseOutlineRegular, ReferenceChip, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ChatViewSlotProps, UserContentAttachment } from '../contract/slots.ts'
import css from './MessageEditor.module.css'

const NO_LABELS: readonly string[] = []

/** Editor phase; a failed send keeps the draft and reports in place. */
type EditorPhase = 'idle' | 'sending' | 'failed'

export interface MessageEditorProps {
  /** Original message text the editor starts from. */
  initialText: string
  /** Attachments carried by the message; shown read-only and never edited. */
  attachments: readonly UserContentAttachment[]
  /** Session reference labels carried by the message; shown read-only. */
  referenceLabels?: readonly string[]
  /** Skill names the message loaded; shown read-only. */
  skillNames?: readonly string[]
  /**
   * Submit the edited text.
   * @param text - current editor text.
   * @returns whether the host accepted the edit; a rejected or thrown edit keeps the editor open.
   */
  onSend: (text: string) => Promise<boolean>
  /** Leave the editor without changing the message. */
  onCancel: () => void
  /** The owning view's locale seat, passed down as a plain prop. */
  t: ChatViewSlotProps['t']
}

/** Recorded display name of one attachment, when the message carries one. */
function attachmentName(attachment: UserContentAttachment): string | undefined {
  if (attachment.type === 'file') return attachment.file.name
  const image = attachment.image
  return 'attachment' in image ? image.label ?? image.attachment.name : image.preview.name
}

/**
 * Render the in-place editor for one user message. Ctrl/⌘ + Enter sends, Escape
 * cancels, and an empty draft cannot be sent.
 * @param props - original text, read-only chips, submit and cancel callbacks, locale seat.
 * @returns the editor element.
 */
export function MessageEditor({
  initialText, attachments, referenceLabels = NO_LABELS, skillNames = NO_LABELS,
  onSend, onCancel, t,
}: MessageEditorProps) {
  const [text, setText] = useState(initialText)
  const [phase, setPhase] = useState<EditorPhase>('idle')
  const ref = useRef<HTMLTextAreaElement>(null)

  useLayoutEffect(() => {
    // The textarea mounts before layout effects run.
    const node = ref.current as HTMLTextAreaElement
    node.focus()
    node.setSelectionRange(node.value.length, node.value.length)
  }, [])

  useLayoutEffect(() => {
    const node = ref.current as HTMLTextAreaElement
    const fit = (): void => {
      node.style.height = 'auto'
      // scrollHeight excludes the border that the border-box height includes.
      node.style.height = `${node.scrollHeight + node.offsetHeight - node.clientHeight}px`
    }
    fit()
    // A width change rewraps the text; the refit height leaves the width unchanged.
    const observer = new ResizeObserver(fit)
    observer.observe(node)
    return () => { observer.disconnect() }
  }, [text])

  const sending = phase === 'sending'
  const empty = text.trim() === ''
  const canSend = !sending && !empty

  const submit = async (): Promise<void> => {
    if (!canSend) return
    setPhase('sending')
    let accepted = false
    try {
      accepted = await onSend(text)
    } catch {
      // Host failures surface as the in-place report below; the draft stays.
      accepted = false
    }
    if (!accepted) setPhase('failed')
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Escape') {
      if (sending) return
      event.preventDefault()
      event.stopPropagation()
      onCancel()
      return
    }
    // keyCode 229 is the legacy IME-composition signal engines emit without isComposing.
    const composing = event.nativeEvent.isComposing || Reflect.get(event.nativeEvent, 'keyCode') === 229
    if (event.key !== 'Enter' || !(event.ctrlKey || event.metaKey) || composing) return
    event.preventDefault()
    event.stopPropagation()
    void submit()
  }

  const sendTooltip = sending || !empty ? t('message.edit.send') : t('message.edit.empty')
  return (
    <div className={css.editor} data-message-editor="" aria-busy={sending || undefined}>
      {attachments.length > 0 && (
        <div className={css.chips} role="group" aria-label={t('message.edit.readonlyAttachments')}>
          {attachments.map((attachment, index) => {
            const name = attachmentName(attachment)
            const kind = attachment.type === 'image' ? 'image' : 'file'
            const label = name ?? t('message.edit.unnamedImage')
            return (
              <span key={`${kind}:${index}`} className={css.chip} title={label} data-readonly-chip={kind}>
                {attachment.type === 'file'
                  ? <FileTypeIcon path={attachment.file.name} className={css.chipIcon} />
                  : <FileTypeIcon kind="image" className={css.chipIcon} />}
                <span className={css.chipLabel}>{label}</span>
              </span>
            )
          })}
        </div>
      )}
      {referenceLabels.length > 0 && (
        <div className={css.chips} role="group" aria-label={t('message.edit.readonlyReferences')}>
          {referenceLabels.map((label, index) => (
            <ReferenceChip key={`reference:${index}`} appearance="session" label={label} title={label} />
          ))}
        </div>
      )}
      {skillNames.length > 0 && (
        <div className={css.chips} role="group" aria-label={t('message.edit.readonlySkills')}>
          {skillNames.map((name, index) => (
            <ReferenceChip key={`skill:${index}`} appearance="skill" label={name} title={name} />
          ))}
        </div>
      )}
      <textarea
        ref={ref}
        rows={1}
        className={css.input}
        aria-label={t('message.edit.label')}
        value={text}
        onChange={(event) => { setText(event.currentTarget.value) }}
        onKeyDown={onKeyDown}
      />
      {phase === 'failed' && (
        <div className={css.failure} role="alert">{t('message.edit.failed')}</div>
      )}
      <div className={css.footer}>
        <span className={css.hint}>{t('message.edit.hint')}</span>
        <Tooltip label={t('message.edit.cancel')} side="bottom">
          <button
            type="button"
            className={css.action}
            aria-label={t('message.edit.cancel')}
            onClick={onCancel}
          >
            <IconCloseOutlineRegular />
          </button>
        </Tooltip>
        <Tooltip label={sendTooltip} side="bottom" openOnClick={!sending && empty}>
          {/* Native disabled buttons do not deliver the hover/focus events Tooltip needs. */}
          <button
            type="button"
            className={css.action}
            aria-label={t('message.edit.send')}
            aria-disabled={!canSend || undefined}
            data-unavailable={!canSend || undefined}
            onClick={() => { void submit() }}
          >
            <IconCheckOutlineRegular />
          </button>
        </Tooltip>
      </div>
    </div>
  )
}
