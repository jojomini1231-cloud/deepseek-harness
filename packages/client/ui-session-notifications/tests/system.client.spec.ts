/** Permission gating and browser adaptation of the operating-system notification channel. */
import { describe, expect, it } from 'vitest'
import {
  browserNotificationPort,
  createSystemNotifier,
  readNotificationConstructor,
  type NotificationConstructor,
  type NotificationContent,
  type NotificationPermission,
} from '../src/client/system.ts'

const content: NotificationContent = { title: 'Fix the parser', body: 'Turn completed', tag: 'session-1' }

/** Constructor standing in for the browser Notification API, recording what it shows. */
class StubNotification {
  static permission: NotificationPermission = 'granted'
  static prompts = 0

  static requestPermission(): Promise<NotificationPermission> {
    StubNotification.prompts += 1
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

  static readonly shown: StubNotification[] = []
}

/** Reset the shared stub between cases. */
function resetStub(permission: NotificationPermission): void {
  StubNotification.permission = permission
  StubNotification.prompts = 0
  StubNotification.shown.length = 0
}

/** Port recording what the notifier asked for, with a permission the test controls. */
function recordingPort(permission: NotificationPermission, resolvesTo: NotificationPermission = permission): {
  readonly port: {
    readonly permission: NotificationPermission
    requestPermission(): Promise<NotificationPermission>
    show(content: NotificationContent, onActivate: () => void): void
  }
  readonly shown: NotificationContent[]
  readonly activations: (() => void)[]
  readonly requests: () => number
  readonly setPermission: (next: NotificationPermission) => void
} {
  const shown: NotificationContent[] = []
  const activations: (() => void)[] = []
  let requests = 0
  let current = permission
  return {
    port: {
      get permission() {
        return current
      },
      requestPermission() {
        requests += 1
        return Promise.resolve(resolvesTo)
      },
      show(shownContent, onActivate) {
        shown.push(shownContent)
        activations.push(onActivate)
      },
    },
    shown,
    activations,
    requests: () => requests,
    setPermission: (next) => { current = next },
  }
}

describe('createSystemNotifier', () => {
  it('ignores every request without a port', () => {
    const notifier = createSystemNotifier(undefined)
    expect(() => { notifier.show(content, () => {}) }).not.toThrow()
  })

  it('shows the notification once permission is granted', () => {
    const recording = recordingPort('granted')
    let activated = 0
    createSystemNotifier(recording.port).show(content, () => { activated += 1 })
    expect(recording.shown).toEqual([content])
    expect(recording.requests()).toBe(0)
    recording.activations[0]?.()
    expect(activated).toBe(1)
  })

  it('shows the notification that triggered the permission request', async () => {
    const recording = recordingPort('default', 'granted')
    createSystemNotifier(recording.port).show(content, () => {})
    expect(recording.requests()).toBe(1)
    await Promise.resolve()
    expect(recording.shown).toEqual([content])
  })

  it('stays silent when the permission request is refused', async () => {
    const recording = recordingPort('default', 'denied')
    createSystemNotifier(recording.port).show(content, () => {})
    await Promise.resolve()
    expect(recording.requests()).toBe(1)
    expect(recording.shown).toEqual([])
  })

  it('keeps only the notification that opened the prompt', async () => {
    const shown: NotificationContent[] = []
    const permission = { current: 'default' as NotificationPermission, resolve: (_: NotificationPermission) => {} }
    const port = {
      get permission() {
        return permission.current
      },
      requestPermission(): Promise<NotificationPermission> {
        return new Promise((resolve) => { permission.resolve = resolve })
      },
      show(shownContent: NotificationContent): void {
        shown.push(shownContent)
      },
    }
    const notifier = createSystemNotifier(port)
    notifier.show(content, () => {})
    notifier.show(content, () => {})
    permission.resolve('granted')
    await Promise.resolve()
    await Promise.resolve()
    expect(shown).toEqual([content])
  })

  it('shows later notifications once the pending permission is granted', () => {
    const recording = recordingPort('default', 'granted')
    const notifier = createSystemNotifier(recording.port)
    notifier.show(content, () => {})
    recording.setPermission('granted')
    notifier.show(content, () => {})
    expect(recording.shown).toEqual([content])
  })

  it('never prompts again once permission is refused', () => {
    const recording = recordingPort('denied')
    const notifier = createSystemNotifier(recording.port)
    notifier.show(content, () => {})
    notifier.show(content, () => {})
    expect(recording.requests()).toBe(0)
    expect(recording.shown).toEqual([])
  })
})

describe('readNotificationConstructor', () => {
  it('reads the constructor from the given scope', () => {
    resetStub('granted')
    const ctor: NotificationConstructor = StubNotification
    expect(readNotificationConstructor({ Notification: ctor })).toBe(ctor)
  })

  it('reports a browser without notifications as absent', () => {
    expect(readNotificationConstructor({})).toBeUndefined()
  })
})

describe('browserNotificationPort', () => {
  it('is absent when the browser has no constructor', () => {
    expect(browserNotificationPort(undefined, () => {})).toBeUndefined()
  })

  it('reports the constructor permission', () => {
    resetStub('denied')
    const ctor: NotificationConstructor = StubNotification
    expect(browserNotificationPort(ctor, () => {})?.permission).toBe('denied')
  })

  it('requests permission through the constructor', async () => {
    resetStub('default')
    const ctor: NotificationConstructor = StubNotification
    await expect(browserNotificationPort(ctor, () => {})?.requestPermission()).resolves.toBe('default')
    expect(StubNotification.prompts).toBe(1)
  })

  it('shows a tagged notification and activates through the window and the caller', () => {
    resetStub('granted')
    const ctor: NotificationConstructor = StubNotification
    let activated = 0
    let focused = 0
    browserNotificationPort(ctor, () => { focused += 1 })?.show(content, () => { activated += 1 })
    expect(StubNotification.shown).toHaveLength(1)
    const shown = StubNotification.shown[0]
    expect(shown?.title).toBe('Fix the parser')
    expect(shown?.options).toEqual({ body: 'Turn completed', tag: 'session-1' })
    shown?.onclick?.()
    expect(focused).toBe(1)
    expect(activated).toBe(1)
    expect(shown?.closed).toBe(1)
  })
})
