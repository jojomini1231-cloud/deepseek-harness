/** Notification decisions over the Session status table. */
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { describe, expect, it } from 'vitest'
import { advanceNotifications, type NotificationCursor, type NotificationStatusFacts } from '../src/client/notifications.ts'

const SESSION = 'session-1' as SessionId
const OTHER = 'session-2' as SessionId

/** Facts for a Session with nothing pending and no unread outcome. */
function idle(): NotificationStatusFacts {
  return { pendingKey: undefined, unread: false, failed: false }
}

/** Facts for a Session awaiting one interaction. */
function pending(key: string): NotificationStatusFacts {
  return { ...idle(), pendingKey: key }
}

/** Facts for a Session carrying an unread turn outcome. */
function unread(failed: boolean): NotificationStatusFacts {
  return { ...idle(), unread: true, failed }
}

/** Build a status table from one or more entries. */
function table(...entries: readonly (readonly [SessionId, NotificationStatusFacts])[]): ReadonlyMap<SessionId, NotificationStatusFacts> {
  return new Map(entries)
}

const both = { pending: true, completion: true }

describe('advanceNotifications', () => {
  it('raises nothing on the baseline snapshot', () => {
    const step = advanceNotifications(undefined, table([SESSION, pending('a')], [OTHER, unread(true)]), both)
    expect(step.requests).toEqual([])
  })

  it('keeps the baseline cursors for the next snapshot', () => {
    const baseline = advanceNotifications(undefined, table([SESSION, pending('a')]), both)
    expect(baseline.cursors.get(SESSION)).toEqual({ pendingKey: 'a', unread: false, failed: false })
    expect(advanceNotifications(baseline.cursors, table([SESSION, pending('a')]), both).requests).toEqual([])
  })

  it('raises a pending notification for a new interaction key', () => {
    const step = advanceNotifications(new Map([[SESSION, { pendingKey: undefined, unread: false, failed: false }]]),
      table([SESSION, pending('a')]), both)
    expect(step.requests).toEqual([{ sessionId: SESSION, kind: 'pending' }])
  })

  it('raises a new pending notification after one interaction replaces another', () => {
    const step = advanceNotifications(new Map([[SESSION, { pendingKey: 'a', unread: false, failed: false }]]),
      table([SESSION, pending('b')]), both)
    expect(step.requests).toEqual([{ sessionId: SESSION, kind: 'pending' }])
  })

  it('raises a completion notification when an outcome becomes unread', () => {
    const step = advanceNotifications(new Map([[SESSION, { pendingKey: undefined, unread: false, failed: false }]]),
      table([SESSION, unread(false)]), both)
    expect(step.requests).toEqual([{ sessionId: SESSION, kind: 'completed' }])
  })

  it('raises a failure notification for a failed unread outcome', () => {
    const step = advanceNotifications(new Map([[SESSION, { pendingKey: undefined, unread: false, failed: false }]]),
      table([SESSION, unread(true)]), both)
    expect(step.requests).toEqual([{ sessionId: SESSION, kind: 'failed' }])
  })

  it('prefers the pending interaction when one snapshot brings both', () => {
    const step = advanceNotifications(new Map([[SESSION, { pendingKey: undefined, unread: false, failed: false }]]),
      table([SESSION, { pendingKey: 'a', unread: true, failed: true }]), both)
    expect(step.requests).toEqual([{ sessionId: SESSION, kind: 'pending' }])
  })

  it('does not repeat an outcome that stays unread', () => {
    const step = advanceNotifications(new Map([[SESSION, { pendingKey: undefined, unread: true, failed: false }]]),
      table([SESSION, unread(true)]), both)
    expect(step.requests).toEqual([])
  })

  it('raises once per Session in table order', () => {
    const step = advanceNotifications(new Map([
      [SESSION, { pendingKey: undefined, unread: false, failed: false }],
      [OTHER, { pendingKey: undefined, unread: false, failed: false }],
    ]), table([SESSION, unread(true)], [OTHER, pending('a')]), both)
    expect(step.requests).toEqual([
      { sessionId: SESSION, kind: 'failed' },
      { sessionId: OTHER, kind: 'pending' },
    ])
  })

  it('drops the cursor of a Session that left the snapshot', () => {
    const step = advanceNotifications(new Map([[SESSION, { pendingKey: 'a', unread: true, failed: false }]]),
      table([OTHER, idle()]), both)
    expect(step.cursors.has(SESSION)).toBe(false)
    expect(step.cursors.has(OTHER)).toBe(true)
  })

  it('suppresses the disabled classes', () => {
    const previous: ReadonlyMap<SessionId, NotificationCursor> = new Map([
      [SESSION, { pendingKey: undefined, unread: false, failed: false }],
      [OTHER, { pendingKey: undefined, unread: false, failed: false }],
    ])
    const statuses = table([SESSION, pending('a')], [OTHER, unread(true)])
    expect(advanceNotifications(previous, statuses, { pending: false, completion: true }).requests)
      .toEqual([{ sessionId: OTHER, kind: 'failed' }])
    expect(advanceNotifications(previous, statuses, { pending: true, completion: false }).requests)
      .toEqual([{ sessionId: SESSION, kind: 'pending' }])
    expect(advanceNotifications(previous, statuses, { pending: false, completion: false }).requests).toEqual([])
  })

  it('still records the observed state for disabled classes', () => {
    const step = advanceNotifications(new Map([[SESSION, { pendingKey: undefined, unread: false, failed: false }]]),
      table([SESSION, { pendingKey: 'a', unread: true, failed: false }]),
      { pending: false, completion: false })
    expect(step.cursors.get(SESSION)).toEqual({ pendingKey: 'a', unread: true, failed: false })
  })
})
