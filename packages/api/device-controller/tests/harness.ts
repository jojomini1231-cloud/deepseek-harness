/**
 * Host device-controller tests run against real domain storage and a fake
 * browser carrier, so both halves of the roster — the durable table and the
 * authentication seam Connection consults — are the production ones.
 */

import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import type { BrowserDeviceStore } from '@deepseek-ai/dsh-client-connection'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import DeviceController from '../src/index.ts'
import type { Config } from '../src/index.ts'

/** Carrier double that hands the controller the seam Connection would. */
class FakeConnection {
  /** Registry the controller attached, once it did. */
  attached: BrowserDeviceStore | undefined
  /** When set, attaching throws it, proving a load-time refusal. */
  failAttach: Error | undefined

  attachBrowserDevices(store: BrowserDeviceStore): () => Promise<void> {
    if (this.failAttach !== undefined) throw this.failAttach
    this.attached = store
    return async () => { this.attached = undefined }
  }
}

/** One isolated controller over real memory-backed domain storage. */
export interface DeviceHarness {
  readonly ctx: Context
  readonly controller: DeviceController
  readonly carrier: FakeConnection
  readonly pool: MemoryMediaPool
  readonly backend: MemoryStorageBackend
  /** The registry the controller attached, available once `ready` resolved. */
  store: () => BrowserDeviceStore
  dispose: () => Promise<void>
}

/**
 * Build a controller over a fresh memory-backed domain.
 * @param options - Optional pre-seeded unit data and carrier behavior.
 * @returns The mounted controller, its services, and its teardown.
 */
export async function harness(options: {
  pool?: MemoryMediaPool
  backend?: MemoryStorageBackend
  /** Run before the controller activates, to seed the durable unit. */
  beforeController?: (ctx: Context, facility: DomainFacility) => Promise<void>
  /** Hold the storage unit open until this resolves, so a live `open` races the durable read. */
  holdOpen?: Promise<void>
  /** Register a carrier; false leaves the `connection` service absent. */
  carrier?: boolean
  /** Roster limits to compose; omitted fields take the plugin's own defaults. */
  config?: Partial<Config>
} = {}): Promise<DeviceHarness> {
  const ctx = new Context()
  await ctx.plugin(Storage)
  const pool = options.pool ?? new MemoryMediaPool()
  const backend = options.holdOpen === undefined
    ? options.backend ?? new MemoryStorageBackend(pool)
    : gatedOpenBackend(options.backend ?? new MemoryStorageBackend(pool), options.holdOpen)
  ctx.effect(() => ctx.storage.backend.register('fixture', backend))
  ctx.effect(() => async () => { await backend.close() })
  const facility = new DomainFacility(ctx, { backend: 'fixture' })
  ctx.effect(() => {
    const unmount = ctx.storage.mount('domain', facility)
    ctx.provide('storageDomain', facility)
    return async () => { await facility.closeAll(); unmount() }
  })
  const carrier = new FakeConnection()
  if (options.carrier !== false) ctx.provide('connection', carrier as never)
  await options.beforeController?.(ctx, facility)
  const fiber = await ctx.plugin(DeviceController, options.config ?? {})
  return {
    ctx,
    controller: ctx.deviceController,
    carrier,
    pool,
    backend,
    store: () => {
      const attached = carrier.attached
      if (attached === undefined) throw new Error('the controller attached no registry')
      return attached
    },
    dispose: () => fiber.dispose(),
  }
}

/**
 * Wrap a backend so the first unit open waits for a gate, letting a case enroll
 * a device while the durable roster is still being read.
 * @param backend - backend whose open is delayed.
 * @param gate - promise the open waits for.
 * @returns the same backend with a delayed `kv.open`.
 */
function gatedOpenBackend(backend: MemoryStorageBackend, gate: Promise<void>): MemoryStorageBackend {
  const original = backend.kv.open.bind(backend.kv)
  backend.kv.open = async (descriptor) => {
    await gate
    return original(descriptor)
  }
  return backend
}
