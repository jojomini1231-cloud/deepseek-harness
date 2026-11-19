// @vitest-environment jsdom
import type { SessionPendingInteraction } from '@deepseek-ai/dsh-client-ui-session/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApprovalInbox, type ApprovalInboxProps } from '../src/client/ApprovalInbox.tsx'
import { ApprovalPeek, type ApprovalPeekProps } from '../src/client/ApprovalPeek.tsx'
import { approvalFacts, presentApproval } from '../src/client/approval-facts.ts'
import { PendingApproval } from '../src/client/contract/slots.ts'

const sid = (value: string): SessionId => value as SessionId

/** Selector hook over one fixed snapshot: how the renderer binds an injected `hooks` source. */
function hook<T>(snapshot: T) {
  return function select<S>(selector: (state: T) => S): S { return selector(snapshot) }
}

const COPY: Record<string, string> = {
  escalation: 'Tool {toolName} asks',
  reject: 'Reject',
  allow: 'Allow',
  allowOnce: 'Allow once',
  'peek.risk': 'Full access',
  'peek.write': 'Write',
  'peek.permission': 'Permission',
  'peek.open': 'Open session',
  'peek.payloadShow': 'Show raw payload',
  'peek.payloadHide': 'Hide raw payload',
  'peek.cancel': 'Cancel',
  'peek.confirmAllow': 'Allow anyway',
  'peek.confirm': 'Runs with {mode}',
  'inbox.title': 'Waiting for approval',
  'inbox.count': '{count} waiting',
  'inbox.denyAll': 'Reject all',
  'inbox.allowAll': 'Allow all',
  'inbox.needsReview': 'Full access needs a decision',
}

const t = (key: string, params?: Record<string, string | number>): string => {
  let text = COPY[key] ?? key
  for (const [name, value] of Object.entries(params ?? {})) text = text.replace(`{${name}}`, String(value))
  return text
}

const mapOf = (...approvals: readonly PendingApproval[]): ReadonlyMap<SessionId, SessionPendingInteraction> =>
  new Map(approvals.map(approval => [approval.sessionId, approval as SessionPendingInteraction]))

const write = (sessionId = 's1'): PendingApproval => new PendingApproval(sid(sessionId), {
  toolName: 'bash',
  reason: 'escalate sandbox to workspace-write: rebuild the frontend bundle',
})

const danger = (sessionId = 's1'): PendingApproval => new PendingApproval(sid(sessionId), {
  toolName: 'bash',
  reason: 'escalate sandbox to danger-full-access: delete the temporary build directory',
})

function peekProps(
  approvals: readonly PendingApproval[],
  sessionId = sid('s1'),
  openSession = vi.fn(),
  resolveDetail: (sessionId: SessionId, callId: string | undefined) => string | undefined = () => undefined,
): ApprovalPeekProps {
  return {
    sessionId,
    t,
    usePending: hook(mapOf(...approvals)),
    resolveReason: (reason: NonNullable<PendingApproval['displayReason']>) => reason.en,
    openSession,
    resolveDetail,
  } as ApprovalPeekProps
}

function inboxProps(
  approvals: readonly PendingApproval[],
  resolveDetail: (sessionId: SessionId, callId: string | undefined) => string | undefined = () => undefined,
): ApprovalInboxProps {
  return {
    t,
    usePending: hook(mapOf(...approvals)),
    resolveReason: (reason: NonNullable<PendingApproval['displayReason']>) => reason.en,
    resolveDetail,
  } as ApprovalInboxProps
}

afterEach(() => { cleanup() })

describe('approvalFacts', () => {
  it('reads the escalated mode and justification out of the audit reason', () => {
    expect(approvalFacts({
      reason: 'escalate sandbox to danger-full-access: drop the staging table',
      fallback: 'Tool bash asks',
    })).toEqual({ action: 'drop the staging table', mode: 'danger-full-access', danger: true })
  })

  it('keeps a narrower escalation out of the danger tier', () => {
    expect(approvalFacts({
      reason: 'escalate sandbox to workspace-write: touch one file',
      fallback: 'Tool bash asks',
    })).toEqual({ action: 'touch one file', mode: 'workspace-write', danger: false })
  })

  it('prefers the localized prompt for an asker without structure', () => {
    expect(approvalFacts({ reason: 'hook denied', displayReason: 'A hook needs a decision', fallback: 'x' }))
      .toEqual({ action: 'A hook needs a decision', mode: '', danger: false })
  })

  it('falls back to the audit reason, then to the caller copy', () => {
    expect(approvalFacts({ reason: 'hook denied', fallback: 'x' }))
      .toEqual({ action: 'hook denied', mode: '', danger: false })
    expect(approvalFacts({ fallback: ' Tool bash asks ' }))
      .toEqual({ action: 'Tool bash asks', mode: '', danger: false })
  })

  it('resolves requester copy before reducing a pending request', () => {
    const pending = new PendingApproval(sid('s1'), {
      toolName: 'bash',
      displayReason: { en: 'Localized prompt', zh: '本地化提示' },
    })
    expect(presentApproval(pending, reason => reason.zh ?? '', 'fallback'))
      .toEqual({ action: '本地化提示', mode: '', danger: false })
  })
})

describe('ApprovalPeek', () => {
  it('renders nothing while the Session has no pending approval', () => {
    const { container } = render(<ApprovalPeek {...peekProps([])} />)
    expect(container.innerHTML).toBe('')
  })

  it('renders nothing when another domain owns the Session interaction', () => {
    const question: SessionPendingInteraction =
      { key: 'question:1', kind: 'question', sessionId: sid('s1') } as SessionPendingInteraction
    const props = { ...peekProps([]), usePending: hook(new Map([[sid('s1'), question]])) } as ApprovalPeekProps
    const { container } = render(<ApprovalPeek {...props} />)
    expect(container.innerHTML).toBe('')
  })

  it('grants a sandbox write request in one click', async () => {
    const pending = write()
    render(<ApprovalPeek {...peekProps([pending])} />)

    expect(screen.getByText('bash')).toBeTruthy()
    expect(screen.getByText('rebuild the frontend bundle')).toBeTruthy()
    expect(screen.queryByText('Full access')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Allow' }))

    await expect(pending.result).resolves.toBe('allowed-once')
  })

  it('refuses from the strip', async () => {
    const pending = write()
    render(<ApprovalPeek {...peekProps([pending])} />)

    fireEvent.click(screen.getByRole('button', { name: 'Reject' }))

    await expect(pending.result).resolves.toBe('rejected')
  })

  it('asks a second time before granting unrestricted host access', async () => {
    const pending = danger()
    render(<ApprovalPeek {...peekProps([pending])} />)

    expect(screen.getByText('Full access')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Allow once' }))

    expect(screen.getByText('Runs with danger-full-access')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByText('Runs with danger-full-access')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Allow once' }))
    fireEvent.click(screen.getByRole('button', { name: 'Allow anyway' }))

    await expect(pending.result).resolves.toBe('allowed-once')
  })

  it('shows the tier and permission, and opens the asking Session', () => {
    const openSession = vi.fn()
    render(<ApprovalPeek {...peekProps([write()], sid('s1'), openSession)} />)

    expect(screen.getByText('Write')).toBeTruthy()
    expect(screen.getByText('workspace-write')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Open session' }))

    expect(openSession).toHaveBeenCalledWith('s1')
  })

  it('opens the payload this request will run', () => {
    const pending = write()
    render(<ApprovalPeek {...peekProps([pending], sid('s1'), vi.fn(), () => 'echo hi')} />)

    fireEvent.click(screen.getByRole('button', { name: 'Show raw payload' }))
    expect(screen.getByText('echo hi')).toBeTruthy()

    fireEvent.click(screen.getByText('echo hi'))
    fireEvent.click(screen.getByRole('button', { name: 'Hide raw payload' }))
    expect(screen.queryByText('echo hi')).toBeNull()
  })

  it('offers no payload when no source resolves one', () => {
    render(<ApprovalPeek {...peekProps([write()])} />)

    expect(screen.queryByRole('button', { name: 'Show raw payload' })).toBeNull()
  })

  it('ignores a decision once the request is settled elsewhere', async () => {
    const pending = write()
    await pending.answer('rejected')
    render(<ApprovalPeek {...peekProps([pending])} />)

    fireEvent.click(screen.getByRole('button', { name: 'Allow' }))

    await expect(pending.result).resolves.toBe('rejected')
  })

  it('returns to the first step when settlement fails', async () => {
    const pending = danger()
    vi.spyOn(pending, 'answer').mockRejectedValue(new Error('settled elsewhere'))
    render(<ApprovalPeek {...peekProps([pending])} />)

    fireEvent.click(screen.getByRole('button', { name: 'Allow once' }))
    fireEvent.click(screen.getByRole('button', { name: 'Allow anyway' }))

    await expect.poll(() => screen.queryByText('Runs with danger-full-access')).toBeNull()
  })
})

describe('ApprovalInbox', () => {
  it('renders nothing while no approval is pending', () => {
    const { container } = render(<ApprovalInbox {...inboxProps([])} />)
    expect(container.innerHTML).toBe('')
  })

  it('clears the sidebar footer instead of covering it', () => {
    const foot = document.createElement('div')
    foot.setAttribute('data-sidebar-foot', '')
    foot.getBoundingClientRect = () => ({ top: window.innerHeight - 76, height: 76 }) as DOMRect
    document.body.append(foot)
    try {
      render(<ApprovalInbox {...inboxProps([write()])} />)
      expect(screen.getByRole('button', { name: '1 waiting' }).style.bottom).toBe('88px')
    } finally {
      foot.remove()
    }
  })

  it('drains one queued request from the panel', async () => {
    const pending = write()
    render(<ApprovalInbox {...inboxProps([pending])} />)

    fireEvent.click(screen.getByRole('button', { name: '1 waiting' }))
    expect(screen.getByRole('dialog', { name: 'Waiting for approval' })).toBeTruthy()
    expect(screen.getByText('rebuild the frontend bundle')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }))

    await expect(pending.result).resolves.toBe('rejected')
  })

  it('confirms unrestricted access before granting it', async () => {
    const pending = danger()
    render(<ApprovalInbox {...inboxProps([pending])} />)

    fireEvent.click(screen.getByRole('button', { name: '1 waiting' }))
    fireEvent.click(screen.getByRole('button', { name: 'Allow once' }))
    expect(screen.getByText('Runs with danger-full-access')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByText('Runs with danger-full-access')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Allow once' }))
    fireEvent.click(screen.getByRole('button', { name: 'Allow anyway' }))

    await expect(pending.result).resolves.toBe('allowed-once')
  })

  it('clears the second step when settlement fails', async () => {
    const pending = danger()
    vi.spyOn(pending, 'answer').mockRejectedValue(new Error('settled elsewhere'))
    render(<ApprovalInbox {...inboxProps([pending])} />)

    fireEvent.click(screen.getByRole('button', { name: '1 waiting' }))
    fireEvent.click(screen.getByRole('button', { name: 'Allow once' }))
    fireEvent.click(screen.getByRole('button', { name: 'Allow anyway' }))

    await expect.poll(() => screen.queryByText('Runs with danger-full-access')).toBeNull()
  })

  it('keeps a queue with unrestricted access out of the batch grant', async () => {
    const pending = danger()
    render(<ApprovalInbox {...inboxProps([pending])} />)

    fireEvent.click(screen.getByRole('button', { name: '1 waiting' }))
    const allowAll = screen.getByRole('button', { name: 'Allow all' })
    expect((allowAll as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Reject all' }))

    await expect(pending.result).resolves.toBe('rejected')
  })

  it('opens the payload of one queued request', () => {
    const pending = write()
    render(<ApprovalInbox {...inboxProps([pending], () => 'echo hi')} />)
    fireEvent.click(screen.getByRole('button', { name: '1 waiting' }))

    fireEvent.click(screen.getByRole('button', { name: 'Show raw payload' }))
    expect(screen.getByText('echo hi')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Hide raw payload' }))
    expect(screen.queryByText('echo hi')).toBeNull()
  })

  it('grants one queued write request from its own row', async () => {
    const pending = write()
    render(<ApprovalInbox {...inboxProps([pending])} />)

    fireEvent.click(screen.getByRole('button', { name: '1 waiting' }))
    fireEvent.click(screen.getByRole('button', { name: 'Allow' }))

    await expect(pending.result).resolves.toBe('allowed-once')
  })

  it('ignores a queued row that settled elsewhere', async () => {
    const pending = write()
    await pending.answer('rejected')
    render(<ApprovalInbox {...inboxProps([pending])} />)

    fireEvent.click(screen.getByRole('button', { name: '1 waiting' }))
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }))

    await expect(pending.result).resolves.toBe('rejected')
  })

  it('leaves the panel open on keys other than Escape', () => {
    render(<ApprovalInbox {...inboxProps([write()])} />)

    fireEvent.click(screen.getByRole('button', { name: '1 waiting' }))
    fireEvent.keyDown(document, { key: 'Enter' })

    expect(screen.getByRole('dialog', { name: 'Waiting for approval' })).toBeTruthy()
  })

  it('grants every queued write request at once', async () => {
    const first = write('s1')
    const second = write('s2')
    render(<ApprovalInbox {...inboxProps([first, second])} />)

    fireEvent.click(screen.getByRole('button', { name: '2 waiting' }))
    expect(screen.queryByText('Full access needs a decision')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Allow all' }))

    await expect(first.result).resolves.toBe('allowed-once')
    await expect(second.result).resolves.toBe('allowed-once')
  })

  it('closes the second step, then the panel, on Escape', () => {
    render(<ApprovalInbox {...inboxProps([danger()])} />)

    fireEvent.click(screen.getByRole('button', { name: '1 waiting' }))
    fireEvent.click(screen.getByRole('button', { name: 'Allow once' }))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByText('Runs with danger-full-access')).toBeNull()
    expect(screen.getByRole('dialog', { name: 'Waiting for approval' })).toBeTruthy()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Waiting for approval' })).toBeNull()
  })

  it('closes the panel from the pill and from the backdrop', () => {
    render(<ApprovalInbox {...inboxProps([write()])} />)

    fireEvent.click(screen.getByRole('button', { name: '1 waiting' }))
    fireEvent.click(screen.getByRole('button', { name: '1 waiting' }))
    expect(screen.queryByRole('dialog', { name: 'Waiting for approval' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '1 waiting' }))
    const backdrop = document.querySelector('[class*="scrim"]')
    expect(backdrop).not.toBeNull()
    fireEvent.click(backdrop as Element)
    expect(screen.queryByRole('dialog', { name: 'Waiting for approval' })).toBeNull()
  })
})
