/**
 * Sidebar presentation facts for one pending approval.
 *
 * The sandbox layer writes a structured audit reason (`escalate sandbox to
 * <mode>: <justification>`), so the compact surfaces can show the asker's own
 * one-sentence justification instead of reprinting the whole localized
 * prompt. Every other asker supplies prose only; that prose becomes the
 * action line unchanged.
 * @module @deepseek-ai/dsh-client-ui-approval/approval-facts
 */

import type { ApprovalPresentationRequest } from './contract/slots.ts'

/** Audit reason written by `approveEscalation`; the mode vocabulary is closed upstream. */
const ESCALATION_REASON = /^escalate sandbox to ([a-z][a-z-]*): ([\s\S]+)$/

/** Sandbox modes that grant unrestricted host access, so their cards carry the danger tier. */
const DANGER_MODES: ReadonlySet<string> = new Set(['danger-full-access'])

/** What a compact approval surface shows, already reduced to one line plus a tier. */
export interface ApprovalFacts {
  /** The asker's one-sentence action, or its whole prose prompt when it has no structure. */
  readonly action: string
  /**
   * Sandbox mode this request escalates to, empty when the asker is outside the
   * sandbox layer. `danger` stays the tier; this names the permission it grants.
   */
  readonly mode: string
  /** Whether granting this request reaches unrestricted host access. */
  readonly danger: boolean
}

/**
 * Reduce one approval request to its compact presentation facts.
 * @param request - localized prompt, structured reason, and the fallback copy for a silent asker.
 * @returns the action line, the escalated mode when the sandbox layer asked, and the danger tier.
 */
export function approvalFacts(request: {
  /** Localized prompt the asker supplied; preferred over the audit reason. */
  readonly displayReason?: string | undefined
  /** Structured audit reason; the only source of the escalated mode. */
  readonly reason?: string | undefined
  /** Copy used when the asker supplied neither. */
  readonly fallback: string
}): ApprovalFacts {
  const escalation = request.reason === undefined ? null : ESCALATION_REASON.exec(request.reason)
  const mode = escalation?.[1]
  const justification = escalation?.[2]
  if (mode !== undefined && justification !== undefined) {
    return { action: justification.trim(), mode, danger: DANGER_MODES.has(mode) }
  }
  const prose = request.displayReason ?? request.reason ?? request.fallback
  return { action: prose.trim(), mode: '', danger: false }
}

/**
 * Present one pending approval for a compact surface, resolving the asker's
 * localized copy first.
 * @param approval - request whose copy and reason drive the presentation.
 * @param resolveReason - resolver for the asker's localized presentation copy.
 * @param fallback - copy used when the asker supplied neither a prompt nor a reason.
 * @returns the compact facts shared by every sidebar and queue surface.
 */
export function presentApproval(
  approval: {
    readonly toolName: string
    readonly reason: string | undefined
    readonly displayReason: ApprovalPresentationRequest['displayReason']
  },
  resolveReason: (reason: NonNullable<ApprovalPresentationRequest['displayReason']>) => string,
  fallback: string,
): ApprovalFacts {
  return approvalFacts({
    reason: approval.reason,
    displayReason: approval.displayReason === undefined ? undefined : resolveReason(approval.displayReason),
    fallback,
  })
}
