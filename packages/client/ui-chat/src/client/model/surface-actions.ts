/** Chat-owned mapping from Session command results to UI-facing outcomes. */

import type { Context } from '@deepseek-ai/cordis'
import type { SessionSeq } from '@deepseek-ai/dsh-session/types'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { RetractMessageResult } from '../contract/slots.ts'

/** Stable Host retraction refusal codes this Client distinguishes. */
const BUSY_CODE = 'session/busy'
const UNAVAILABLE_CODE = 'session/rewind-unavailable'

/**
 * Map one Host retraction refusal to the reason the Chat row reports.
 * Every other code, including an unknown one, is a generic failure.
 * @param code - Host failure code.
 * @returns the reason a user row can act on.
 */
export function retractRefusalReason(code: string): 'busy' | 'unavailable' | 'failed' {
  if (code === BUSY_CODE) return 'busy'
  if (code === UNAVAILABLE_CODE) return 'unavailable'
  return 'failed'
}

/** Session command result shared by retraction and edit. */
type ConversationCommandResult = RemoteResult<{ seq: SessionSeq }>

/**
 * Convert one retraction command result to the Chat row outcome.
 * @param result - Host result, or null when the transport itself failed.
 * @returns acceptance, or the refusal reason.
 */
export function retractOutcome(result: ConversationCommandResult | null): RetractMessageResult {
  if (result === null) return { ok: false, reason: 'failed' }
  if (result.ok) return { ok: true }
  return { ok: false, reason: retractRefusalReason(result.error.code) }
}

/**
 * Convert one edit command result to its accepted bit.
 * @param result - Host result, or null when the transport itself failed.
 * @returns whether the Host accepted the edit.
 */
export function editAccepted(result: ConversationCommandResult | null): boolean {
  return result?.ok === true
}

/** Minimal Conversation face the composer focus needs. */
export interface ComposerFocusTarget {
  readonly input: {
    /**
     * Resolve the per-Session input facade.
     * @param actx - Session-scope Context the composer belongs to.
     * @returns the facade whose `focus` returns the keyboard.
     */
    for(actx: Context): { focus(): void }
  }
}

/**
 * Return the keyboard to the Session composer when the Conversation service is
 * mounted; a Client composed without it has no composer to focus.
 * @param conversation - mounted Conversation service, when any.
 * @param actx - Session-scope Context the composer belongs to.
 */
export function focusComposer(conversation: ComposerFocusTarget | undefined, actx: Context): void {
  conversation?.input.for(actx).focus()
}
