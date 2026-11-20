/** Session notification switches shared by the Host and Client faces; types only. */
import type { Volatile } from '@deepseek-ai/cordis'

/** Which Session events raise an operating-system notification, and when the browser may raise it. */
export interface SessionNotificationsConfig {
  /** Raise a notification when a Session starts awaiting user input. */
  notifyPendingInteraction: Volatile<boolean>
  /** Raise a notification when an unread turn outcome (completed or failed) appears. */
  notifyCompletion: Volatile<boolean>
  /** Suppress notifications while the visible, focused browser window would already show the change. */
  notifyOnlyWhenUnfocused: Volatile<boolean>
}
