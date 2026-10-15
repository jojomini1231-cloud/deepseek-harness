/** Device-roster store: reads, supersession, write outcomes, and publishing only at the commit point. */

import { describe, expect, it, vi } from 'vitest'
import { RemoteError } from '@deepseek-ai/dsh-client-test-runtime'
import type { BrowserDeviceView, RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import { createDeviceRoster } from '../src/client/device-store.ts'
import type { DeviceRosterDeps } from '../src/client/device-store.ts'

/** One device view with only the fields a case cares about set. */
function device(id: string, overrides: Partial<BrowserDeviceView> = {}): BrowserDeviceView {
  return { id, userAgent: 'Agent/1', firstSeenAt: 1, lastSeenAt: 1, ...overrides }
}

function ok<T>(value: T): Promise<RemoteResult<T>> {
  return Promise.resolve({ ok: true, value })
}

/** Dependencies whose every call is a spy a case can re-program. */
function deps(overrides: Partial<DeviceRosterDeps> = {}): DeviceRosterDeps {
  return {
    list: vi.fn(() => ok<BrowserDeviceView[]>([])),
    rename: vi.fn(() => ok(device('a'))),
    revoke: vi.fn(() => ok(undefined)),
    ...overrides,
  }
}

/** A promise a case settles by hand, for supersession cases. */
function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason: Error) => void
} {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((settle, fail) => { resolve = settle; reject = fail })
  return { promise, resolve, reject }
}

describe('device roster store', () => {
  it('publishes the roster once the first read answers', async () => {
    const roster = createDeviceRoster(deps({ list: () => ok([device('a'), device('b')]) }))
    expect(roster.hooks.devices.getSnapshot().status).toBe('loading')
    await roster.refresh()
    const state = roster.hooks.devices.getSnapshot()
    expect(state.status).toBe('ready')
    expect(state.devices.map(row => row.id)).toEqual(['a', 'b'])
  })

  it('reports a Remote failure and a transport rejection the same way', async () => {
    for (const list of [
      () => Promise.resolve<RemoteResult<BrowserDeviceView[]>>(
        { ok: false, error: new RemoteError('gateway/internal', 'no', {}) },
      ),
      () => Promise.reject(new Error('transport down')),
    ]) {
      const roster = createDeviceRoster(deps({ list }))
      await roster.refresh()
      expect(roster.hooks.devices.getSnapshot().status).toBe('error')
    }
  })

  it('lets a newer read supersede one still in flight', async () => {
    const slow = deferred<RemoteResult<BrowserDeviceView[]>>()
    const list = vi.fn<DeviceRosterDeps['list']>()
      .mockImplementationOnce(() => slow.promise)
      .mockImplementationOnce(() => ok([device('fresh')]))
    const roster = createDeviceRoster(deps({ list }))
    const first = roster.refresh()
    await roster.refresh()
    expect(roster.hooks.devices.getSnapshot().devices.map(row => row.id)).toEqual(['fresh'])
    // The superseded read settles after the newer one and publishes nothing.
    slow.resolve({ ok: true, value: [device('stale')] })
    await first
    expect(roster.hooks.devices.getSnapshot().devices.map(row => row.id)).toEqual(['fresh'])
  })

  it('leaves a superseded read\'s failure unpublished', async () => {
    const slow = deferred<RemoteResult<BrowserDeviceView[]>>()
    const list = vi.fn<DeviceRosterDeps['list']>()
      .mockImplementationOnce(() => slow.promise)
      .mockImplementationOnce(() => ok([device('fresh')]))
    const roster = createDeviceRoster(deps({ list }))
    const first = roster.refresh()
    await roster.refresh()
    // The older read rejects after a newer one published; its failure is discarded.
    slow.reject(new Error('superseded'))
    await first
    expect(roster.hooks.devices.getSnapshot().status).toBe('ready')
    expect(roster.hooks.devices.getSnapshot().devices.map(row => row.id)).toEqual(['fresh'])
  })

  it('renames through the Remote and re-reads what the Host acknowledged', async () => {
    const list = vi.fn<DeviceRosterDeps['list']>()
      .mockImplementationOnce(() => ok([device('a')]))
      .mockImplementationOnce(() => ok([device('a', { name: 'Kitchen' })]))
    const rename = vi.fn<DeviceRosterDeps['rename']>(() => ok(device('a', { name: 'Kitchen' })))
    const roster = createDeviceRoster(deps({
      list,
      rename,
    }))
    await roster.refresh()
    expect(await roster.rename('a', 'Kitchen')).toBe('done')
    expect(rename).toHaveBeenCalledWith('a', 'Kitchen')
    expect(roster.hooks.devices.getSnapshot().devices[0]!.name).toBe('Kitchen')
    expect(roster.hooks.devices.getSnapshot().pending).toEqual([])
  })

  it('reports a refused write and an unresolved transport without refreshing', async () => {
    for (const rename of [
      () => Promise.resolve<RemoteResult<BrowserDeviceView>>(
        { ok: false, error: new RemoteError('gateway/internal', 'no', {}) },
      ),
      () => Promise.reject(new Error('transport down')),
    ]) {
      const list = vi.fn<DeviceRosterDeps['list']>(() => ok([device('a')]))
      const roster = createDeviceRoster(deps({
        list,
        rename,
      }))
      await roster.refresh()
      const reads = list.mock.calls.length
      expect(await roster.rename('a', 'Kitchen')).toBe('failed')
      expect(list.mock.calls.length).toBe(reads)
      expect(roster.hooks.devices.getSnapshot().pending).toEqual([])
    }
  })

  it('revokes through the Remote and drops the row the Host no longer reports', async () => {
    const list = vi.fn()
      .mockImplementationOnce(() => ok([device('a'), device('b')]))
      .mockImplementationOnce(() => ok([device('a')]))
    const revoke = vi.fn<DeviceRosterDeps['revoke']>(() => ok(undefined))
    const roster = createDeviceRoster(deps({
      list,
      revoke,
    }))
    await roster.refresh()
    expect(await roster.revoke('b')).toBe('done')
    expect(revoke).toHaveBeenCalledWith('b')
    expect(roster.hooks.devices.getSnapshot().devices.map(row => row.id)).toEqual(['a'])
  })

  it('marks the addressed row pending while its write is in flight', async () => {
    const pending = deferred<RemoteResult<void>>()
    const roster = createDeviceRoster(deps({ revoke: () => pending.promise }))
    await roster.refresh()
    const write = roster.revoke('a')
    expect(roster.hooks.devices.getSnapshot().pending).toEqual(['a'])
    pending.resolve({ ok: true, value: undefined })
    await write
    expect(roster.hooks.devices.getSnapshot().pending).toEqual([])
  })

  it('names a self-revoke when the re-read it causes is refused', async () => {
    // Revoking this browser's own device leaves it unable to read the roster,
    // which is the one way an accepted revoke produces a failed re-read.
    const list = vi.fn<DeviceRosterDeps['list']>()
      .mockImplementationOnce(() => ok([device('a')]))
      .mockImplementationOnce(() => Promise.reject(new Error('unauthorized')))
    const roster = createDeviceRoster(deps({ list }))
    await roster.refresh()
    expect(await roster.revoke('a')).toBe('done')
    const state = roster.hooks.devices.getSnapshot()
    expect(state.status).toBe('error')
    expect(state.signedOut).toBe(true)
  })

  it('reports a failed re-read after a rename as a plain read failure', async () => {
    // A rename cannot revoke the caller, so the same failed re-read is not
    // reported as a sign-out.
    const list = vi.fn<DeviceRosterDeps['list']>()
      .mockImplementationOnce(() => ok([device('a')]))
      .mockImplementationOnce(() => Promise.reject(new Error('down')))
    const roster = createDeviceRoster(deps({ list }))
    await roster.refresh()
    expect(await roster.rename('a', 'Kitchen')).toBe('done')
    const state = roster.hooks.devices.getSnapshot()
    expect(state.status).toBe('error')
    expect(state.signedOut).toBe(false)
  })

  it('clears the sign-out once a later read answers', async () => {
    const list = vi.fn<DeviceRosterDeps['list']>()
      .mockImplementationOnce(() => ok([device('a')]))
      .mockImplementationOnce(() => Promise.reject(new Error('unauthorized')))
      .mockImplementationOnce(() => ok([device('b')]))
    const roster = createDeviceRoster(deps({ list }))
    await roster.refresh()
    await roster.revoke('a')
    expect(roster.hooks.devices.getSnapshot().signedOut).toBe(true)
    // A browser that can read the roster again is no longer signed out.
    await roster.refresh()
    const state = roster.hooks.devices.getSnapshot()
    expect(state.signedOut).toBe(false)
    expect(state.devices.map(row => row.id)).toEqual(['b'])
  })
})
