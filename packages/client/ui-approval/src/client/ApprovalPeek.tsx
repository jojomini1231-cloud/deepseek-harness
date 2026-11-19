/** Sidebar hover-card approval body: tier, action, permission, and the decision. */
import { useMemo, useState } from 'react'
import { Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  HostObservable, InjectFace, PropsLocale, PropsRuntime,
} from '@deepseek-ai/dsh-client-ui-slots'
import type { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionPendingInteraction } from '@deepseek-ai/dsh-client-ui-session/client'
// Type-only service merge for the sidebar row slot.
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import { presentApproval } from './approval-facts.ts'
import { PendingApproval, type ApprovalDecision } from './contract/slots.ts'
import css from './ApprovalPeek.module.css'

/** What the card body reads from its registration. */
export interface ApprovalPeekInjected {
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
   * Bring the asking Session to the front.
   * @param sessionId - Session owning the request.
   */
  openSession: (sessionId: SessionId) => void
  /**
   * Resolve the payload this request will run.
   * @param sessionId - Session owning the request.
   * @param callId - Tool call the request settles, when it names one.
   * @returns payload text, or undefined when no package can produce one.
   */
  resolveDetail: (sessionId: SessionId, callId: ToolCallId | undefined) => string | undefined
}

/** Owner share for one sidebar row, the localizable seat, and this card's own injections. */
export type ApprovalPeekProps =
  PropsRuntime<'sidebar.session.row.hover'>
  & PropsLocale<'approval'>
  & InjectFace<ApprovalPeekInjected>

/** The Session's own pending approval, or nothing when another domain holds it. */
function pendingApprovalOf(
  pending: ReadonlyMap<SessionId, SessionPendingInteraction>,
  sessionId: SessionId,
): PendingApproval | undefined {
  const value = pending.get(sessionId)
  return value instanceof PendingApproval ? value : undefined
}

/**
 * Answer one pending approval from the sidebar.
 *
 * The card body is one of several answer surfaces, so a settlement that loses a
 * race is expected: the losing surface only stops offering the buttons, and the
 * pending snapshot removes the card by itself.
 * @param approval - request to settle.
 * @param outcome - the user's decision.
 * @param clear - drops the local second-step state of this surface.
 */
function settle(approval: PendingApproval, outcome: ApprovalDecision, clear: () => void): void {
  if (!approval.answerable) return
  void approval.answer(outcome).catch(() => { clear() })
}

/**
 * Render the approval body inside the Session row's hover card.
 *
 * Title, working directory, and relative time belong to the card itself; this
 * body continues below them with the tier, the action, and the decision.
 * @param props - owning Session, approval copy, and the pending-interaction hook.
 * @returns the body, or nothing while this Session has no pending approval.
 */
export function ApprovalPeek(props: ApprovalPeekProps) {
  const { sessionId, t, usePending, resolveReason, openSession, resolveDetail } = props
  const pending = usePending(map => map)
  const approval = useMemo(() => pendingApprovalOf(pending, sessionId), [pending, sessionId])
  const [armed, setArmed] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  if (approval === undefined) return null
  const facts = presentApproval(approval, resolveReason, t('escalation', { toolName: approval.toolName }))
  const confirming = armed === approval.key
  const detail = resolveDetail(sessionId, approval.callId)
  const open = expanded === approval.key
  const clear = (): void => { setArmed(null) }
  return (
    <div className={css.root} data-approval-peek="">
      <div className={css.head}>
        <span className={css.tool}>{approval.toolName}</span>
        <Tag tone={facts.danger ? 'danger' : 'info'}>
          {facts.danger ? t('peek.risk') : t('peek.write')}
        </Tag>
      </div>
      <div className={css.rule} />
      <p className={css.action}>{facts.action}</p>
      {facts.mode !== '' && (
        <div className={css.perm}>
          <span>{t('peek.permission')}</span>
          <code>{facts.mode}</code>
        </div>
      )}
      {detail !== undefined && (
        <>
          <button
            type="button"
            className={css.disclose}
            aria-expanded={open}
            onClick={(event) => {
              event.stopPropagation()
              setExpanded(open ? null : approval.key)
            }}
          >
            {open ? t('peek.payloadHide') : t('peek.payloadShow')}
          </button>
          {open && <pre className={css.payload} onClick={(event) => { event.stopPropagation() }}>{detail}</pre>}
        </>
      )}
      {confirming && <p className={css.warn}>{t('peek.confirm', { mode: facts.mode })}</p>}
      <div className={css.rule} />
      <div className={css.actions}>
        <button
          type="button"
          className={css.act}
          onClick={(event) => {
            event.stopPropagation()
            if (confirming) clear()
            else settle(approval, 'rejected', clear)
          }}
        >
          {confirming ? t('peek.cancel') : t('reject')}
        </button>
        <button
          type="button"
          className={`${css.act} ${css.actPrimary}`}
          onClick={(event) => {
            event.stopPropagation()
            if (!confirming && facts.danger) {
              setArmed(approval.key)
              return
            }
            settle(approval, 'allowed-once', clear)
          }}
        >
          {confirming ? t('peek.confirmAllow') : facts.danger ? t('allowOnce') : t('allow')}
        </button>
      </div>
      <div className={css.foot}>
        <button
          type="button"
          className={css.link}
          onClick={(event) => { event.stopPropagation(); openSession(sessionId) }}
        >
          {t('peek.open')}
        </button>
      </div>
    </div>
  )
}
