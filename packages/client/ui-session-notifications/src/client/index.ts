/** Raises operating-system notifications when a Session awaits user input or leaves an unread turn outcome. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type { SyncedConfig } from '@deepseek-ai/dsh-client-config/types'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-session-status/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionNotificationsConfig } from '../types.ts'
import { de, en, es, fr, ja, pt, ru, zh } from './locales.ts'
import { advanceNotifications, statusFacts, type NotificationCursor, type NotificationKind } from './notifications.ts'
import { browserNotificationPort, createSystemNotifier, readNotificationConstructor } from './system.ts'

const NS = 'session.notifications'

/** Services the notification fan-out reads: the status table, Session names, and Session navigation. */
export const inject = ['locale', 'sessions', 'uiSession', 'uiSession.sessionStatus', 'uiWorkspace']

/**
 * Watch the Session status table and raise one notification per new pending interaction or new unread outcome.
 *
 * Switches are read per snapshot, so a user changing them never restarts the plugin. Whether the visible window
 * already shows the change is read per snapshot too: the suppression only applies while this browser tab is
 * foreground, which is the case where the user is looking at the Session list itself.
 * @param ctx - client plugin context.
 * @param config - Host-synced switches.
 */
export function apply(ctx: Context, config: SyncedConfig<SessionNotificationsConfig>): void {
  ctx.effect(
    () => ctx.locale.register(NS, { en, zh, ja, es, fr, de, ru, pt }),
    'notifications: dictionaries',
  )
  const t = ctx.locale.bind(NS)
  const notifier = createSystemNotifier(
    browserNotificationPort(readNotificationConstructor(globalThis), () => { window.focus() }),
  )
  let cursors: ReadonlyMap<SessionId, NotificationCursor> | undefined

  const raise = (sessionId: SessionId, kind: NotificationKind): void => {
    const title = ctx.sessions.list.getSnapshot().byId[sessionId]?.displayTitle || t('untitled')
    notifier.show({ title, body: t(kind), tag: sessionId }, () => {
      window.focus()
      ctx.uiWorkspace.openSession(sessionId)
    })
  }

  const evaluate = (): void => {
    const step = advanceNotifications(cursors, statusFacts(ctx.uiSession.sessionStatus.getSnapshot()), {
      pending: config.notifyPendingInteraction.get() ?? true,
      completion: config.notifyCompletion.get() ?? true,
    })
    cursors = step.cursors
    if (step.requests.length === 0) return
    if ((config.notifyOnlyWhenUnfocused.get() ?? true) && windowIsForeground()) return
    for (const request of step.requests) raise(request.sessionId, request.kind)
  }

  ctx.effect(() => {
    const stop = ctx.uiSession.sessionStatus.subscribe(evaluate)
    evaluate()
    return stop
  }, 'notifications: session status')
}

/**
 * Whether this window is the visible, focused one.
 * @returns true when a notification would duplicate what the user already sees.
 */
function windowIsForeground(): boolean {
  return document.visibilityState === 'visible' && document.hasFocus()
}
