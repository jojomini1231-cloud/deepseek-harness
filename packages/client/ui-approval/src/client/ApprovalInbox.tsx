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
}

/**
 * Answer one queued request.
 *
 * Losing a settlement race is expected because the Session's own composer can
 * answer at the same time: the losing surface only clears its local step, and
 * the pending snapshot drops the row.
 * @param approval - request to settle.
 * @param outcome - the user's decision.
 * @param clear - drops the local second-step state of this queue.
 */
function settle(approval: PendingApproval, outcome: ApprovalDecision, clear: () => void): void {
  if (!approval.answerable) return
  void approval.answer(outcome).catch(() => { clear() })
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
 * @param props - approval copy and the pending-interaction hook.
 * @returns the pill and, while open, the drawer; nothing when no approval is pending.
 */
export function ApprovalInbox(props: ApprovalInboxProps) {
  const { t, usePending, resolveReason, resolveDetail } = props
  const pending = usePending(map => map)
  const rows = useMemo<readonly QueueRow[]>(
    () => [...pending.values()]
      .filter((value): value is PendingApproval => value instanceof PendingApproval)
      .map(approval => ({
        approval,
        facts: presentApproval(approval, resolveReason, t('escalation', { toolName: approval.toolName })),
      })),
    [pending, resolveReason, t],
  )
  const clearance = useFootClearance()
  const [open, setOpen] = useState(false)
  const [armed, setArmed] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  // Derived, not synchronized: a drained queue hides the drawer and its second step.
  const showing = open && rows.length > 0
  const confirming = armed !== null && rows.some(row => row.approval.key === armed) ? armed : null
  useEffect(() => {
    if (!showing) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      event.preventDefault()
      if (confirming !== null) setArmed(null)
      else setOpen(false)
    }
    document.addEventListener('keydown', onKey, true)
    return () => { document.removeEventListener('keydown', onKey, true) }
  }, [showing, confirming])
  if (rows.length === 0) return null
  const danger = rows.some(row => row.facts.danger)
  const clear = (): void => { setArmed(null) }
  return (
    <>
      <button
        type="button"
        className={css.pill}
        data-approval-pill=""
        style={clearance === undefined ? undefined : { bottom: clearance }}
        aria-expanded={showing}
        aria-label={t('inbox.count', { count: rows.length })}
        onClick={() => { setOpen(!showing) }}
      >
        <span className={css.pillCount} aria-hidden="true">{rows.length}</span>
        <span className={css.pillLabel}>{t('inbox.title')}</span>
      </button>
      {showing && (
        <>
          <div className={css.scrim} onClick={() => { setOpen(false) }} />
          <aside className={css.drawer} data-approval-inbox="" role="dialog" aria-label={t('inbox.title')}>
            <div className={css.head}>
              <h2 className={css.heading}>{t('inbox.title')}</h2>
              <span className={css.badge}>{rows.length}</span>
            </div>
            <div className={css.body}>
              {rows.map(({ approval, facts }) => (
                <div key={approval.key} className={confirming === approval.key ? `${css.item} ${css.itemArmed}` : css.item}>
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
                  {confirming === approval.key && (
                    <p className={css.warn}>{t('peek.confirm', { mode: facts.mode })}</p>
                  )}
                  <div className={css.itemActions}>
                    <Button
                      variant="outline"
                      onClick={() => {
                        if (confirming === approval.key) clear()
                        else settle(approval, 'rejected', clear)
                      }}
                    >
                      {confirming === approval.key ? t('peek.cancel') : t('reject')}
                    </Button>
                    <Button
                      variant="primary"
                      onClick={() => {
                        if (confirming !== approval.key && facts.danger) {
                          setArmed(approval.key)
                          return
                        }
                        settle(approval, 'allowed-once', clear)
                      }}
                    >
                      {confirming === approval.key
                        ? t('peek.confirmAllow')
                        : facts.danger ? t('allowOnce') : t('allow')}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
            <div className={css.foot}>
              <span className={css.note}>{danger ? t('inbox.needsReview') : ''}</span>
              <span className={css.spacer} />
              <Button
                variant="outline"
                onClick={() => {
                  for (const { approval } of rows) settle(approval, 'rejected', clear)
                }}
              >
                {t('inbox.denyAll')}
              </Button>
              <Button
                variant="primary"
                disabled={danger}
                onClick={() => {
                  for (const { approval } of rows) settle(approval, 'allowed-once', clear)
                }}
              >
                {t('inbox.allowAll')}
              </Button>
            </div>
          </aside>
        </>
      )}
    </>
  )
}
