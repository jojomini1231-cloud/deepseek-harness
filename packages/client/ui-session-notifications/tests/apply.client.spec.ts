// @vitest-environment jsdom
/** Wiring of the notification plugin: status subscriptions, switches, focus suppression, and activation. */
import { Context } from '@deepseek-ai/cordis'
import type { SyncedConfigValues } from '@deepseek-ai/dsh-client-config/types'
import { syncedConfig } from '@deepseek-ai/dsh-client-test-runtime'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apply } from '../src/client/index.ts'
import type { SessionNotificationsConfig } from '../src/types.ts'

const SESSION = 'session-1' as SessionId

/** Status row the status service publishes, limited to the fields notification decisions read. */
interface StubStatus {
  readonly pendingInteraction: { readonly key: string } | undefined
  readonly completionUnread: boolean
  readonly completionFailed: boolean
}

/** Status table the stub service publishes. */
type StatusTable = ReadonlyMap<SessionId, StubStatus>

/** Background Session with no unread outcome. */
function idle(): StubStatus {
  return { pendingInteraction: undefined, completionUnread: false, completionFailed: false }
}

/** Session awaiting one interaction. */
function pending(key: string): StubStatus {
  return { ...idle(), pendingInteraction: { key } }
}

/** Session carrying an unread turn outcome. */
function unread(failed: boolean): StubStatus {
  return { ...idle(), completionUnread: true, completionFailed: failed }
}

/** Notification the plugin asked the browser to show. */
class StubNotification {
  static permission: 'granted' | 'denied' | 'default' = 'granted'
  static shown: StubNotification[] = []

  static requestPermission(): Promise<'granted' | 'denied' | 'default'> {
    return Promise.resolve(StubNotification.permission)
  }

  onclick: (() => void) | null = null
  closed = 0
  readonly options: { readonly body: string; readonly tag: string }

  constructor(readonly title: string, options: { readonly body: string; readonly tag: string }) {
    this.options = options
    StubNotification.shown.push(this)
  }

  close(): void {
    this.closed += 1
  }
}

/** Everything one plugin activation needs, with the status table the test drives. */
interface Harness {
  readonly notice: () => readonly StubNotification[]
  readonly opened: readonly string[]
  readonly dictionaries: readonly string[]
  readonly publish: (statuses: StatusTable) => void
}

const switches: SyncedConfigValues = {
  notifyPendingInteraction: true,
  notifyCompletion: true,
  notifyOnlyWhenUnfocused: true,
}

/**
 * Activate the plugin over stubbed services.
 * @param options - switch overrides, initial status table, and window focus.
 * @returns the recorders a case asserts on.
 */
function activate(options: {
  readonly values?: SyncedConfigValues
  readonly statuses?: StatusTable
  readonly focused?: boolean
  readonly visible?: boolean
  readonly titles?: Readonly<Record<string, string>>
} = {}): Harness {
  const ctx = new Context()
  const dictionaries: string[] = []
  const opened: string[] = []
  let statuses: StatusTable = options.statuses ?? new Map<SessionId, StubStatus>()
  const listeners = new Set<() => void>()
  ctx.provide('locale', {
    register: (ns: string) => { dictionaries.push(ns); return () => {} },
    bind: (ns: string) => (key: string) => `${ns}/${key}`,
  })
  const titles = options.titles ?? {}
  ctx.provide('sessions', {
    list: {
      getSnapshot: () => ({
        byId: Object.fromEntries(Object.entries(titles).map(([id, displayTitle]) => [id, { displayTitle }])),
      }),
    },
  })
  const sessionStatus = {
    getSnapshot: () => statuses,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
  }
  ctx.provide('uiSession', { sessionStatus })
  ctx.provide('uiSession.sessionStatus', sessionStatus)
  ctx.provide('uiWorkspace', { openSession: (target: string) => { opened.push(target) } })
  vi.spyOn(document, 'hasFocus').mockReturnValue(options.focused ?? false)
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => (options.visible === false ? 'hidden' : 'visible'),
  })
  apply(ctx, syncedConfig<SessionNotificationsConfig>(options.values ?? switches))
  return {
    notice: () => StubNotification.shown,
    opened,
    dictionaries,
    publish: (next) => { statuses = next; for (const listener of listeners) listener() },
  }
}

beforeEach(() => {
  StubNotification.permission = 'granted'
  StubNotification.shown = []
  vi.stubGlobal('Notification', StubNotification)
  vi.spyOn(window, 'focus').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('apply', () => {
  it('registers the notification dictionaries', () => {
    expect(activate().dictionaries).toEqual(['session.notifications'])
  })

  it('raises nothing for the state it starts with', () => {
    const harness = activate({ statuses: new Map([[SESSION, pending('a')]]) })
    expect(harness.notice()).toEqual([])
  })

  it('raises a pending notification for a Session that starts waiting', () => {
    const harness = activate({ titles: { [SESSION]: 'Fix the parser' }, statuses: new Map([[SESSION, idle()]]) })
    harness.publish(new Map([[SESSION, pending('a')]]))
    expect(harness.notice()).toHaveLength(1)
    expect(harness.notice()[0]?.title).toBe('Fix the parser')
    expect(harness.notice()[0]?.options).toEqual({ body: 'session.notifications/pending', tag: 'session-1' })
  })

  it('names an unnamed Session with the localized fallback title', () => {
    const harness = activate({ statuses: new Map([[SESSION, idle()]]) })
    harness.publish(new Map([[SESSION, unread(true)]]))
    expect(harness.notice()[0]?.title).toBe('session.notifications/untitled')
    expect(harness.notice()[0]?.options.body).toBe('session.notifications/failed')
  })

  it('raises a completion notification for a new unread outcome', () => {
    const harness = activate({ statuses: new Map([[SESSION, idle()]]) })
    harness.publish(new Map([[SESSION, unread(false)]]))
    expect(harness.notice()[0]?.options.body).toBe('session.notifications/completed')
  })

  it('opens the Session and focuses the window when the user activates the notification', () => {
    const harness = activate({ statuses: new Map([[SESSION, idle()]]) })
    harness.publish(new Map([[SESSION, pending('a')]]))
    harness.notice()[0]?.onclick?.()
    expect(window.focus).toHaveBeenCalled()
    expect(harness.opened).toEqual([SESSION])
    expect(harness.notice()[0]?.closed).toBe(1)
  })

  it('suppresses notifications while this window is focused', () => {
    const harness = activate({ statuses: new Map([[SESSION, idle()]]), focused: true })
    harness.publish(new Map([[SESSION, pending('a')]]))
    expect(harness.notice()).toEqual([])
  })

  it('raises notifications for a visible window that is not focused', () => {
    const harness = activate({ statuses: new Map([[SESSION, idle()]]), focused: false })
    harness.publish(new Map([[SESSION, pending('a')]]))
    expect(harness.notice()).toHaveLength(1)
  })

  it('raises notifications while the tab is hidden even when it has focus', () => {
    const harness = activate({ statuses: new Map([[SESSION, idle()]]), focused: true, visible: false })
    harness.publish(new Map([[SESSION, pending('a')]]))
    expect(harness.notice()).toHaveLength(1)
  })

  it('raises notifications in a focused window when suppression is switched off', () => {
    const harness = activate({
      statuses: new Map([[SESSION, idle()]]),
      focused: true,
      values: { ...switches, notifyOnlyWhenUnfocused: false },
    })
    harness.publish(new Map([[SESSION, pending('a')]]))
    expect(harness.notice()).toHaveLength(1)
  })

  it('honours the pending switch', () => {
    const harness = activate({ statuses: new Map([[SESSION, idle()]]), values: { ...switches, notifyPendingInteraction: false } })
    harness.publish(new Map([[SESSION, pending('a')]]))
    expect(harness.notice()).toEqual([])
  })

  it('honours the completion switch', () => {
    const harness = activate({ statuses: new Map([[SESSION, idle()]]), values: { ...switches, notifyCompletion: false } })
    harness.publish(new Map([[SESSION, unread(true)]]))
    expect(harness.notice()).toEqual([])
  })

  it('enables every class when the Host sent no switch values', () => {
    const harness = activate({ statuses: new Map([[SESSION, idle()]]), values: {} })
    harness.publish(new Map([[SESSION, pending('a')]]))
    expect(harness.notice()).toHaveLength(1)
  })

  it('suppresses a focused window when the Host sent no suppression switch', () => {
    const harness = activate({ statuses: new Map([[SESSION, idle()]]), values: {}, focused: true })
    harness.publish(new Map([[SESSION, pending('a')]]))
    expect(harness.notice()).toEqual([])
  })

  it('does not repeat a notification for the state it already reported', () => {
    const harness = activate({ statuses: new Map([[SESSION, idle()]]) })
    harness.publish(new Map([[SESSION, pending('a')]]))
    expect(harness.notice()).toHaveLength(1)
    harness.publish(new Map([[SESSION, pending('a')]]))
    expect(harness.notice()).toHaveLength(1)
  })
})
