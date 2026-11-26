/** Frame-wide approval queue: a pending count pill and the drawer that drains it. */
import { useEffect, useMemo, useState } from 'react'
import { Button, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  HostObservable, InjectFace, PropsLocale, PropsRuntime,
} from '@deepseek-ai/dsh-client-ui-slots'
import type { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionPendingInteraction } from '@deepseek-ai/dsh-client-ui-session/client'
// Type-only service merge for the frame overlay slot.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { presentApproval, type ApprovalFacts } from './approval-facts.ts'
import { PendingApproval, type ApprovalDecision } from './contract/slots.ts'
import css from './ApprovalInbox.module.css'

/** What the queue reads from its registration. */
export interface ApprovalInboxInjected {
  hooks: {
    /** Effective pending interaction per Session, published by the Session UI. */
    pending: HostObservable<ReadonlyMap<SessionId, SessionPendingInteraction>>
  }
  /**
   * Resolve requester-owned copy in the current UI language.
   * @param reason - localized presentation text with an English fallback.
   * @returns text for the active UI language.
   */
  resolveReason: (reason: NonNullable<PendingApproval['displayReason']>) => string
  /**
   * Resolve the payload this request will run.
   * @param sessionId - Session owning the request.
   * @param callId - Tool call the request settles, when it names one.
   * @returns payload text, or undefined when no package can produce one.
   */
  resolveDetail: (sessionId: SessionId, callId: ToolCallId | undefined) => string | undefined
}

/** Frame overlay seat, copy, and this queue's own injections. */
export type ApprovalInboxProps =
  PropsRuntime<'shell.overlay'>
  & PropsLocale<'approval'>
  & InjectFace<ApprovalInboxInjected>

/** One queued request with the facts its row shows. */
interface QueueRow {
  readonly approval: PendingApproval
  readonly facts: ApprovalFacts
  /** Name of the Session that owns the request. */
  readonly sessionTitle: string
}

/**
 * Answer one queued request.
 *
 * Losing a settlement race is expected because the Session's own composer can
 * answer at the same time: the pending snapshot drops the row on every surface.
 * A rejected settlement leaves the row in place, so the reader can decide again.
 * @param approval - request to settle.
 * @param outcome - the user's decision.
 */
function settle(approval: PendingApproval, outcome: ApprovalDecision): void {
  if (!approval.answerable) return
  void approval.answer(outcome).catch(() => undefined)
}

/**
 * Clearance between the viewport bottom and the sidebar footer, so the pill sits
 * above the account row instead of covering it.
 * @returns the offset in px, or undefined while the footer is not on screen.
 */
function useFootClearance(): number | undefined {
  const [clearance, setClearance] = useState<number | undefined>(undefined)
  useEffect(() => {
    const foot = document.querySelector('[data-sidebar-foot]')
    if (foot === null) return
    const measure = (): void => {
      const { top, height } = foot.getBoundingClientRect()
      setClearance(height === 0 ? undefined : Math.round(window.innerHeight - top) + 12)
    }
    measure()
    window.addEventListener('resize', measure)
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure)
    observer?.observe(foot)
    return () => {
      window.removeEventListener('resize', measure)
      observer?.disconnect()
    }
  }, [])
  return clearance
}

/**
 * Render the pending-approval count pill and its queue drawer.
 *
 * Every row names its own Session: the queue spans Sessions, so with several
 * waiting the tool and the action alone do not say where a decision lands. The
 * name comes from the Session list, not from the request, so a rename follows.
 * @param props - approval copy, the pending-interaction hook, and the Session list.
 * @returns the pill and, while open, the drawer; nothing when no approval is pending.
 */
export function ApprovalInbox(props: ApprovalInboxProps) {
  const { t, usePending, useSessions, resolveReason, resolveDetail } = props
  const pending = usePending(map => map)
  const listed = useSessions(state => state.byId)
  const rows = useMemo<readonly QueueRow[]>(
    () => [...pending.values()]
      .filter((value): value is PendingApproval => value instanceof PendingApproval)
      .map(approval => ({
        approval,
        facts: presentApproval(approval, resolveReason, t('escalation', { toolName: approval.toolName })),
        sessionTitle: listed[approval.sessionId]?.displayTitle ?? t('inbox.untitledSession'),
      })),
    [pending, listed, resolveReason, t],
  )
  const clearance = useFootClearance()
  const [open, setOpen] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [batchArmed, setBatchArmed] = useState(false)
  // Derived, not synchronized: a drained queue hides the drawer.
  const showing = open && rows.length > 0
  const dangerCount = rows.filter(row => row.facts.danger).length
  // Derived, not synchronized: closing the drawer or draining the queue drops the step.
  const confirming = showing && batchArmed && dangerCount > 0
  const close = (): void => { setBatchArmed(false); setOpen(false) }
  useEffect(() => {
    if (!showing) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      event.preventDefault()
      if (confirming) setBatchArmed(false)
      else close()
    }
    document.addEventListener('keydown', onKey, true)
    return () => { document.removeEventListener('keydown', onKey, true) }
  }, [showing, confirming])
  // A drained queue closes the drawer, so the next request waits behind the pill.
  const drained = rows.length === 0
  useEffect(() => {
    if (!drained) return
    setBatchArmed(false)
    setOpen(false)
  }, [drained])
  if (drained) return null
  return (
    <>
      <button
        type="button"
        className={css.pill}
        data-approval-pill=""
        style={clearance === undefined ? undefined : { bottom: clearance }}
        aria-expanded={showing}
        aria-label={t('inbox.count', { count: rows.length })}
        onClick={() => { if (showing) close(); else setOpen(true) }}
      >
        <span className={css.pillCount} aria-hidden="true">{rows.length}</span>
        <span className={css.pillLabel}>{t('inbox.title')}</span>
      </button>
      {showing && (
        <>
          <div className={css.scrim} onClick={close} />
          <aside className={css.drawer} data-approval-inbox="" role="dialog" aria-label={t('inbox.title')}>
            <div className={css.head}>
              <h2 className={css.heading}>{t('inbox.title')}</h2>
              <span className={css.badge}>{rows.length}</span>
            </div>
            <div className={css.body}>
              {rows.map(({ approval, facts, sessionTitle }) => (
                <div key={approval.key} className={css.item}>
                  <div className={css.itemSession} data-approval-session="" title={sessionTitle}>
                    {t('inbox.session', { title: sessionTitle })}
                  </div>
                  <div className={css.itemHead}>
                    <span className={css.itemTool}>{approval.toolName}</span>
                    <Tag tone={facts.danger ? 'danger' : 'info'}>
                      {facts.danger ? t('peek.risk') : t('peek.write')}
                    </Tag>
                  </div>
                  <p className={css.itemAction}>{facts.action}</p>
                  {facts.mode !== '' && (
                    <div className={css.itemPerm}>
                      <span>{t('peek.permission')}</span>
                      <code>{facts.mode}</code>
                    </div>
                  )}
                  {(() => {
                    const detail = resolveDetail(approval.sessionId, approval.callId)
                    if (detail === undefined) return null
                    const openDetail = expanded === approval.key
                    return (
                      <>
                        <button
                          type="button"
                          className={css.disclose}
                          aria-expanded={openDetail}
                          onClick={() => { setExpanded(openDetail ? null : approval.key) }}
                        >
                          {openDetail ? t('peek.payloadHide') : t('peek.payloadShow')}
                        </button>
                        {openDetail && <pre className={css.payload}>{detail}</pre>}
                      </>
                    )
                  })()}
                  <div className={css.itemActions}>
                    <Button variant="outline" onClick={() => { settle(approval, 'rejected') }}>
                      {t('reject')}
                    </Button>
                    <Button variant="primary" onClick={() => { settle(approval, 'allowed-once') }}>
                      {facts.danger ? t('allowOnce') : t('allow')}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
            <div className={css.foot}>
              {confirming && (
                <p className={css.warn} data-approval-batch-confirm="">
                  {t('inbox.confirmAll', { count: dangerCount })}
                </p>
              )}
              <span className={css.note}>{dangerCount > 0 && !confirming ? t('inbox.needsReview') : ''}</span>
              <span className={css.spacer} />
              {confirming ? (
                <>
                  <Button variant="outline" onClick={() => { setBatchArmed(false) }}>
                    {t('inbox.cancel')}
                  </Button>
                  <Button
                    variant="primary"
                    onClick={() => {
                      setBatchArmed(false)
                      for (const { approval } of rows) settle(approval, 'allowed-once')
                    }}
                  >
                    {t('inbox.confirmAllowAll')}
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    variant="outline"
                    onClick={() => {
                      for (const { approval } of rows) settle(approval, 'rejected')
                    }}
                  >
                    {t('inbox.denyAll')}
                  </Button>
                  <Button
                    variant="primary"
                    onClick={() => {
                      if (dangerCount > 0) { setBatchArmed(true); return }
                      for (const { approval } of rows) settle(approval, 'allowed-once')
                    }}
                  >
                    {t('inbox.allowAll')}
                  </Button>
                </>
              )}
            </div>
          </aside>
        </>
      )}
    </>
  )
}
