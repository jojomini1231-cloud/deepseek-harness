/**
 * Device-roster state for the settings page: one authoritative read, plus the
 * rename and revoke writes that follow it.
 *
 * `hooks.devices` and the wiring's callbacks carry only plain data and
 * functions, as the slot contract requires; this module owns how they are
 * produced.
 *
 * @module @deepseek-ai/dsh-client-ui-settings-devices/device-store
 */

import type { BrowserDeviceView, RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'

/** What the page renders: the roster plus how its last read settled. */
export interface DevicesSnapshot {
  /** Devices the Host reported, most recently active first. */
  readonly devices: readonly BrowserDeviceView[]
  /** `loading` before the first read answers and during a refresh. */
  readonly status: 'loading' | 'ready' | 'error'
  /** Ids whose write is in flight, so a row can disable its own controls. */
  readonly pending: readonly string[]
  /**
   * Whether this browser revoked itself and can no longer read the roster. The
   * page names that outcome instead of offering a retry that cannot succeed.
   */
  readonly signedOut: boolean
}

/** One write's outcome, decided here so the row only renders it. */
export type DeviceWriteOutcome = 'done' | 'failed'

/** Which write is running, for the one outcome a revoke has and a rename does not. */
type DeviceWrite = 'rename' | 'revoke'

/** Remote calls the store reads; the entry binds them from its own context. */
export interface DeviceRosterDeps {
  /** Read every recorded device. */
  readonly list: () => Promise<RemoteResult<BrowserDeviceView[]>>
  /** Set or clear one device's label. */
  readonly rename: (id: string, name: string) => Promise<RemoteResult<BrowserDeviceView>>
  /** Revoke one device. */
  readonly revoke: (id: string) => Promise<RemoteResult<void>>
}

/** The plain-data face one settings section injects. */
export interface DevicesInjected {
  /** Page state the renderer binds as `useDevices`. */
  readonly hooks: { readonly devices: SnapshotStore<DevicesSnapshot> }
  /** Read the roster; the page calls this on open and after a failure. */
  readonly refresh: () => Promise<void>
  /**
   * Rename one device and re-read once the Host acknowledged it.
   * @param id - device the row addresses.
   * @param name - draft label; blank clears it back to the derived name.
   * @returns `done` after the acknowledged write's refresh, `failed` otherwise.
   */
  readonly rename: (id: string, name: string) => Promise<DeviceWriteOutcome>
  /**
   * Revoke one device and re-read once the Host acknowledged it.
   * @param id - device the row addresses.
   * @returns `done` after the acknowledged write's refresh, `failed` otherwise.
   */
  readonly revoke: (id: string) => Promise<DeviceWriteOutcome>
}

/** The roster's injected face plus the lifetime the entry owns, not the page. */
export interface DeviceRoster extends DevicesInjected {
  /** Release the store; the plugin calls this when it unloads. */
  readonly dispose: () => void
}

/**
 * Build the roster store over a Remote-backed dependency set.
 * @param deps - the `devices` namespace calls this page uses.
 * @returns the injected face and the plugin-owned lifetime.
 */
export function createDeviceRoster(deps: DeviceRosterDeps): DeviceRoster {
  const store = createSnapshotStore<DevicesSnapshot>({
    devices: [], status: 'loading', pending: [], signedOut: false,
  })
  // Supersedes an older read: a refresh issued while one is in flight is the
  // answer the page waits for, so a slow earlier read cannot publish over it.
  let epoch = 0

  const refresh = async (): Promise<void> => {
    const current = ++epoch
    store.set({ ...store.getSnapshot(), status: 'loading' })
    let result: RemoteResult<BrowserDeviceView[]>
    try {
      result = await deps.list()
    } catch (_error: unknown) {
      // Transport rejection has the same visible retry path as a Remote failure.
      if (current === epoch) store.set({ ...store.getSnapshot(), status: 'error' })
      return
    }
    if (current !== epoch) return
    const settled = store.getSnapshot()
    // A read that answers proves this browser is still admitted, whatever an
    // earlier revocation of its own device suggested.
    store.set(result.ok
      ? { ...settled, devices: result.value, status: 'ready', signedOut: false }
      : { ...settled, status: 'error' })
  }

  const write = async (
    kind: DeviceWrite,
    id: string,
    call: () => Promise<RemoteResult<unknown>>,
  ): Promise<DeviceWriteOutcome> => {
    const started = store.getSnapshot()
    store.set({ ...started, pending: [...started.pending, id] })
    let result: RemoteResult<unknown>
    try {
      result = await call()
    } catch (_error: unknown) {
      release(store, id)
      return 'failed'
    }
    release(store, id)
    if (!result.ok) return 'failed'
    // Publish only at the commit point: the roster the page shows is the one
    // the acknowledged write produced, not a local guess at what it changed.
    await refresh()
    // The only way a revoke the Host accepted leaves the roster unreadable is
    // that the revoked device was this browser's own.
    if (kind === 'revoke' && store.getSnapshot().status === 'error') {
      store.set({ ...store.getSnapshot(), signedOut: true })
    }
    return 'done'
  }

  return {
    hooks: { devices: store },
    refresh,
    rename: (id, name) => write('rename', id, () => deps.rename(id, name)),
    revoke: id => write('revoke', id, () => deps.revoke(id)),
    dispose: () => { epoch += 1 },
  }
}

/** Drop one device from the pending set. */
function release(store: SnapshotStore<DevicesSnapshot>, id: string): void {
  const current = store.getSnapshot()
  store.set({ ...current, pending: current.pending.filter(candidate => candidate !== id) })
}
