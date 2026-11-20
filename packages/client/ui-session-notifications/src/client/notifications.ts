/** Notification decisions over the Session status table: which status transitions raise one notification. */
import type { SessionStatusSnapshot } from '@deepseek-ai/dsh-client-ui-session-status/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Outcome classes one notification reports. */
export type NotificationKind = 'pending' | 'completed' | 'failed'

/** Status facts one notification decision needs, projected from the status table. */
export interface NotificationStatusFacts {
  /** Key of the interaction the Session is waiting on; `undefined` when nothing is pending. */
  readonly pendingKey: string | undefined
  /** Whether a turn outcome waits to be read. */
  readonly unread: boolean
  /** Whether that unread outcome is a failure. */
  readonly failed: boolean
}

/** Last notification-relevant facts observed for one Session. */
export interface NotificationCursor {
  /** Key of the pending interaction already observed for this Session; `undefined` when nothing is pending. */
  readonly pendingKey: string | undefined
  /** Whether an unread turn outcome had already been observed. */
  readonly unread: boolean
  /** Whether that observed outcome was a failure. */
  readonly failed: boolean
}

/** Notification classes the user enabled. */
export interface NotificationSwitches {
  /** Whether a Session awaiting user input raises a notification. */
  readonly pending: boolean
  /** Whether an unread turn outcome raises a notification. */
  readonly completion: boolean
}

/** One notification to raise. */
export interface NotificationRequest {
  /** Session the notification names. */
  readonly sessionId: SessionId
  /** What happened. */
  readonly kind: NotificationKind
}

/** Requests raised by one status snapshot, plus the cursors that replace the previous ones. */
export interface NotificationStep {
  /** Notifications the snapshot raised, in table order. */
  readonly requests: readonly NotificationRequest[]
  /** Cursors to pass as `previous` on the next snapshot. */
  readonly cursors: ReadonlyMap<SessionId, NotificationCursor>
}

/**
 * Project the Session status table onto the facts notification decisions read.
 * @param statuses - current Session status table.
 * @returns one fact record per Session, keyed by Session identity.
 */
export function statusFacts(statuses: SessionStatusSnapshot): ReadonlyMap<SessionId, NotificationStatusFacts> {
  const facts = new Map<SessionId, NotificationStatusFacts>()
  for (const [sessionId, status] of statuses) {
    const unread = status.completionUnread
    facts.set(sessionId, {
      pendingKey: status.pendingInteraction?.key,
      unread,
      failed: unread && status.completionFailed,
    })
  }
  return facts
}

/**
 * Decide which notifications one status snapshot raises.
 *
 * A new pending interaction wins over a new outcome for the same Session, because the Session now waits on the user
 * rather than reporting a finished turn. The first snapshot only establishes the baseline: sessions already pending or
 * unread when the browser opens are the state the Session list shows, not new events.
 * @param previous - cursors from the previous snapshot; `undefined` on the first one.
 * @param statuses - status facts to compare against `previous`.
 * @param switches - enabled notification classes.
 * @returns notifications to raise and the cursors replacing `previous`.
 */
export function advanceNotifications(
  previous: ReadonlyMap<SessionId, NotificationCursor> | undefined,
  statuses: ReadonlyMap<SessionId, NotificationStatusFacts>,
  switches: NotificationSwitches,
): NotificationStep {
  const cursors = new Map<SessionId, NotificationCursor>()
  const requests: NotificationRequest[] = []
  for (const [sessionId, status] of statuses) {
    const { pendingKey, unread, failed } = status
    const before = previous?.get(sessionId)
    if (before !== undefined) {
      const pendingRaised = switches.pending && pendingKey !== undefined && pendingKey !== before.pendingKey
      const completionRaised = switches.completion && unread && !before.unread
      if (pendingRaised) requests.push({ sessionId, kind: 'pending' })
      else if (completionRaised) requests.push({ sessionId, kind: failed ? 'failed' : 'completed' })
    }
    cursors.set(sessionId, { pendingKey, unread, failed })
  }
  return { requests, cursors }
}
