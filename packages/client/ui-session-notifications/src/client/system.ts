/** Operating-system notifications behind one port, so the decision logic never touches the browser API directly. */

/** Text one notification shows. */
export interface NotificationContent {
  /** Session name. */
  readonly title: string
  /** Localized statement of what happened. */
  readonly body: string
  /** Replaces an earlier notification of the same tag, so one Session never stacks duplicates. */
  readonly tag: string
}

/** User-visible permission state of the notification channel; mirrors the browser Notification permission. */
export type NotificationPermission = 'granted' | 'denied' | 'default'

/** One shown notification, retained only to close it on activation. */
export interface ShownNotification {
  /** Hide the notification once the user has acted on it. */
  close(): void
}

/** The browser `Notification` surface this package depends on. */
export interface NotificationConstructor {
  /** Current permission without prompting. */
  readonly permission: NotificationPermission
  /** Ask the user; resolves with the resulting permission. */
  requestPermission(): Promise<NotificationPermission>
  /** Construct and show one notification. */
  new (title: string, options: { readonly body: string; readonly tag: string }): ShownNotification & {
    /** Activation handler, assigned after construction. */
    onclick: (() => void) | null
  }
}

/** Everything the notifier needs from the platform. */
export interface NotificationPort {
  /** Current permission without prompting. */
  readonly permission: NotificationPermission
  /** Ask the user and resolve with the resulting permission. */
  requestPermission(): Promise<NotificationPermission>
  /** Show one notification and run `onActivate` if the user activates it. */
  show(content: NotificationContent, onActivate: () => void): void
}

/** Notification channel built over a port. */
export interface SystemNotifier {
  /** Raise one notification unless permission is absent or refused. */
  show(content: NotificationContent, onActivate: () => void): void
}

/**
 * Build the notifier over a platform port.
 *
 * Without a port — a browser that does not implement notifications — every request is a silent no-op. A refused
 * permission stays refused for the browser session, so the prompt is never repeated. A pending permission is requested
 * once; the notification that triggered the request appears when the request grants permission, and notifications
 * raised later during the same prompt are dropped rather than queued, because they describe a moment that has passed.
 * @param port - platform channel, absent when the browser provides none.
 * @returns notifier that reads the permission state on every request.
 */
export function createSystemNotifier(port: NotificationPort | undefined): SystemNotifier {
  let requested = false
  return {
    show(content, onActivate) {
      if (port === undefined) return
      const permission = port.permission
      if (permission === 'denied') return
      if (permission === 'default') {
        if (requested) return
        requested = true
        void port.requestPermission().then((granted) => {
          if (granted === 'granted') port.show(content, onActivate)
        })
        return
      }
      port.show(content, onActivate)
    },
  }
}

/**
 * Read the browser's `Notification` constructor.
 * @param scope - object carrying the browser globals; the browser window in production.
 * @returns the constructor, or `undefined` when the browser does not implement notifications.
 */
export function readNotificationConstructor(scope: object): NotificationConstructor | undefined {
  return (scope as { Notification?: NotificationConstructor }).Notification
}

/**
 * Adapt the browser `Notification` constructor to {@link NotificationPort}.
 *
 * Activating a notification closes it, brings the application window forward, and runs the caller's handler; the
 * handler owns opening the Session, which keeps navigation out of this port.
 * @param ctor - browser constructor, absent when notifications are unavailable.
 * @param activate - brings the application window forward.
 * @returns the port, or `undefined` when the browser cannot show notifications.
 */
export function browserNotificationPort(
  ctor: NotificationConstructor | undefined,
  activate: () => void,
): NotificationPort | undefined {
  if (ctor === undefined) return undefined
  return {
    get permission() {
      return ctor.permission
    },
    requestPermission() {
      return ctor.requestPermission()
    },
    show(content, onActivate) {
      const notification = new ctor(content.title, { body: content.body, tag: content.tag })
      notification.onclick = () => {
        notification.close()
        activate()
        onActivate()
      }
    },
  }
}
