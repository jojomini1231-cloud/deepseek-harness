/**
 * Host owner of the browser-device roster: the registry browser authentication
 * records every launch-token exchange in, and the Remote namespace Settings
 * reads to list, rename, and revoke the browsers that reached this deployment.
 *
 * Records live in the `browser_devices` storage domain, so a revoked browser
 * stays revoked across a Host restart. Authentication answers from the
 * in-memory index, which is why the store is attached before the domain opens
 * and every durable write is queued behind that open. Until the roster has
 * loaded, `admits` answers true for at most `rosterLoadGraceMs`: refusing a
 * device the roster has simply not read would lock every browser out of a
 * deployment that just restarted, but answering true forever would let a
 * browser this deployment already revoked back in. A load that rejects, or one
 * still unread past that grace, admits nothing: an unanswerable revocation
 * question must not become an admission. A domain that refuses to open is
 * logged at load and fails every Remote call, the earliest point this
 * asynchronously opened owner can resolve.
 *
 * @module @deepseek-ai/dsh-api-device-controller
 */

import { randomUUID } from 'node:crypto'
import z from '@deepseek-ai/schemastery'
import { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { BrowserDeviceId, BrowserDeviceSession, BrowserDeviceStore } from '@deepseek-ai/dsh-client-connection'
import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import { browserDevicesDomain } from './storage.ts'
import type { StoredBrowserDevice } from './storage.ts'
import type { BrowserDeviceView } from './types.ts'

export type { BrowserDeviceView } from './types.ts'
export type { StoredBrowserDevice } from './storage.ts'

/** Longest accepted user-set label, in UTF-8 bytes. */
const MAX_NAME_BYTES = 64

/** Longest accepted device id; the roster mints UUIDs. */
const MAX_ID_LENGTH = 128

/** Shortest interval between two durable `lastSeenAt` writes for one device. */
const TOUCH_PERSIST_INTERVAL_MS = 60_000

/** Deployment-varying roster limits, changeable from `cordis.yml`. */
export interface Config {
  /**
   * How long an unread roster may keep admitting unknown devices after the store
   * attaches. Bounds the fail-open window a Host restart opens; a load still
   * unread past it refuses, so a stalled open cannot readmit a revoked browser
   * for the process lifetime. Tighten it to shrink the window at the cost of
   * refusing browsers for longer after a restart. @default 10000
   */
  rosterLoadGraceMs?: number
  /**
   * Most devices the roster keeps. Enrolling beyond it retires the device whose
   * last authenticated request is oldest, so a deployment that keeps minting
   * identities cannot grow the durable table without bound. @default 100
   */
  maxDevices?: number
}

/** Roster limits with every default applied, as this package resolves them. */
type ResolvedConfig = Config & {
  readonly rosterLoadGraceMs: number
  readonly maxDevices: number
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host owner of the `devices` Remote namespace and the browser-device registry. */
    deviceController: DeviceController
  }
}

/**
 * Browser-device registry and its Remote face. The class is both the
 * {@link BrowserDeviceStore} Connection consults and the owner of the `devices`
 * namespace the Settings page calls.
 */
export class DeviceController extends TypertRemoteService implements BrowserDeviceStore {
  /** The browser carrier and the storage facility are both required to record a device. */
  static inject = ['storageDomain', 'connection']

  /** Validated roster limits; every field has a default, so composition may omit them. */
  static Config: z<Config, ResolvedConfig> = z.object({
    rosterLoadGraceMs: z.number().step(1).min(0).max(Number.MAX_SAFE_INTEGER).default(10_000),
    maxDevices: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(100),
  })

  private readonly devices = new Map<BrowserDeviceId, StoredBrowserDevice>()
  /** Roster limits with every default applied. */
  private readonly config: ResolvedConfig
  /** When each device's record last reached the domain, so `touch` coalesces. */
  private readonly persistedAt = new Map<BrowserDeviceId, number>()
  /** Resolves once the durable table is open and merged into memory. */
  private readonly ready: Promise<Domain<typeof browserDevicesDomain>>
  /** Whether the durable roster has been read; until then `admits` answers by the grace window. */
  private loaded = false
  /** Whether the configured grace elapsed with the roster still unread. */
  private graceElapsed = false
  /** Serializes every durable write, so a rename never interleaves with a queued `lastSeenAt`. */
  private chain: Promise<unknown> = Promise.resolve()

  /**
   * @param ctx - Host carrying the browser carrier and the storage domain facility.
   * @param config - roster limits; the Loader applies the schema defaults, and a
   * hand-built context that omits them resolves here.
   */
  constructor(ctx: Context, config: Config) {
    super(ctx, 'deviceController', { namespace: 'devices' })
    this.config = DeviceController.Config(config)
    this.ready = ctx.storageDomain.open(browserDevicesDomain).then(async (domain) => {
      const table = domain.table('devices')
      // A device that enrolled while this read was in flight is written now; its
      // record is the current one, so it wins over anything already stored.
      for (const [id, record] of this.devices) await table.put(id, record)
      // A stored record this process has not seen is adopted as it stands, as a
      // copy: the domain keeps its own object, and `touch` mutates this one.
      for (const [id, record] of table.entries()) {
        if (!this.devices.has(id)) this.devices.set(id, { ...record })
      }
      this.loaded = true
      this.evictOverflow()
      return domain
    })
    // A rejected open becomes a definite refusal: an unanswerable revocation
    // question must not become an admission. The rejection still reaches every
    // Remote call that awaits it.
    void this.ready.catch((error: unknown) => {
      ctx.logger.warn(`device-controller: the browser-device roster failed to open: ${String(error)}`)
    })
    // A load still unread past the grace refuses too, so a stalled open cannot
    // leave a revoked browser admitted for the process lifetime. Unref'd so a
    // pending grace never holds the process open.
    const grace = setTimeout(() => { this.graceElapsed = true }, this.config.rosterLoadGraceMs)
    grace.unref()
    // Registered first so its disposer runs last: the drain below lands the
    // queued writes before the domain that owns them is released. Without this
    // the facility keeps `browser_devices` reserved, and the next activation in
    // this process fails with `already-open`.
    ctx.effect(() => () => this.ready.then(
      domain => domain.close(),
      () => undefined,
    ), 'device-controller: close the roster domain')
    // At unload Connection stops consulting a roster whose owner is already
    // tearing down.
    ctx.effect(() => ctx.connection.attachBrowserDevices(this), 'device-controller: browser-device registry')
    // An exchange persists in the background, so unload drains the queue rather
    // than dropping a device the operator just enrolled.
    ctx.effect(() => () => this.settle(), 'device-controller: drain queued roster writes')
  }

  /**
   * Record the browser that just exchanged the launch token, reusing the record
   * its verified cookie already names when this deployment still knows it.
   * @param session - facts the exchange observed.
   * @returns the device id the minted cookie is bound to.
   */
  open(session: BrowserDeviceSession): BrowserDeviceId {
    const now = Date.now()
    const previous = session.previous
    const known = previous === undefined ? undefined : this.devices.get(previous)
    if (previous !== undefined && known !== undefined) {
      // The address a carrier does not expose is not a moved device, so the
      // last one observed stands rather than being erased by a silent exchange.
      this.devices.set(previous, {
        ...known,
        userAgent: session.userAgent,
        lastSeenAt: now,
        ...(session.address === undefined ? {} : { address: session.address }),
      })
      this.persistedAt.set(previous, now)
      this.persistInBackground(previous)
      return previous
    }
    // A device the roster does not know is a new one: a revoked browser that
    // re-opens the printed URL returns as a fresh row, never the deleted one.
    const id = brandString<BrowserDeviceId>(randomUUID())
    this.devices.set(id, {
      userAgent: session.userAgent,
      firstSeenAt: now,
      lastSeenAt: now,
      ...(session.address === undefined ? {} : { address: session.address }),
    })
    this.persistedAt.set(id, now)
    this.persistInBackground(id)
    // Enrolling past the cap retires the idlest device, so a deployment that
    // keeps minting identities cannot grow the durable table without bound.
    this.evictOverflow()
    return id
  }

  /**
   * Whether one device may still authenticate. Once the durable roster has been
   * read, only a recorded device is admitted. Before that, the answer is true
   * only inside the configured grace: an open that rejected, or one still unread
   * past the grace, admits nothing, because an unanswerable revocation question
   * must not become an admission.
   * @param id - device bound to the presented cookie.
   * @returns true while the device has not been revoked.
   */
  admits(id: BrowserDeviceId): boolean {
    // Once the durable roster has been read it is authoritative: a device it
    // does not hold was revoked, whether here or in an earlier process.
    if (this.loaded) return this.devices.has(id)
    // A device this process itself enrolled was never revoked, so it stays
    // admitted even if a slow load outlasts the grace.
    if (this.devices.has(id)) return true
    // Otherwise the cookie's own signature is the only evidence there is. That
    // is enough inside the grace, and never enough after it.
    return !this.graceElapsed
  }

  /**
   * Record one authenticated request. Memory always moves so the list shows a
   * live `lastSeenAt`; the durable record follows at most once a minute.
   * @param id - device bound to the presented cookie.
   */
  touch(id: BrowserDeviceId): void {
    const record = this.devices.get(id)
    if (record === undefined) return
    const now = Date.now()
    record.lastSeenAt = now
    if (now - (this.persistedAt.get(id) ?? 0) < TOUCH_PERSIST_INTERVAL_MS) return
    this.persistedAt.set(id, now)
    this.persistInBackground(id)
  }

  /**
   * List every device that reached this deployment, most recently active first.
   * Waits for queued writes so the list is what the roster has recorded, not
   * what it is still writing.
   * @returns one view per recorded device.
   */
  @Remote
  async list(): Promise<BrowserDeviceView[]> {
    await this.ready
    await this.settle()
    return [...this.devices.entries()]
      .map(([id, record]) => deviceView(id, record))
      .sort((a, b) => b.lastSeenAt - a.lastSeenAt || a.id.localeCompare(b.id))
  }

  /**
   * Set or clear one device's label.
   * @param id - device to relabel.
   * @param name - new label; an empty or whitespace-only value clears it.
   * @returns the device as the list now reads it.
   * @throws RemoteError with `devices/unknown` when the id is malformed or this
   * deployment never recorded it, or `devices/rejected` when the label is too long.
   */
  @Remote
  async rename(id: string, name: string): Promise<BrowserDeviceView> {
    await this.ready
    const device = this.parseId(id)
    const current = this.devices.get(device)
    if (current === undefined) {
      throw new RemoteError('devices/unknown', `This deployment never recorded device ${id}.`, { id })
    }
    const label = name.trim()
    // Bounded in UTF-8 bytes, so a label of astral or combining characters is
    // held to the same stored size as one of ASCII.
    if (Buffer.byteLength(label, 'utf8') > MAX_NAME_BYTES) {
      throw new RemoteError(
        'devices/rejected',
        `A device label may hold at most ${String(MAX_NAME_BYTES)} bytes.`,
        { id },
      )
    }
    // An empty label clears the field rather than storing one, so the list falls
    // back to the name the device derives from its own user agent.
    const next: StoredBrowserDevice = label === ''
      ? {
        userAgent: current.userAgent, firstSeenAt: current.firstSeenAt, lastSeenAt: current.lastSeenAt,
        ...(current.address === undefined ? {} : { address: current.address }),
      }
      : { ...current, name: label }
    this.devices.set(device, next)
    await this.queue(() => this.persist(device))
    return deviceView(device, next)
  }

  /**
   * Revoke one device. Its signed cookie stops authenticating at the next
   * request, and the durable delete commits before this returns: the browser
   * must open the URL printed by `dsh web` again to return, and it returns as a
   * new device. A delete that fails restores the record and rejects, so a
   * revocation this call reports as failed is one a restart cannot readmit.
   * @param id - device to revoke.
   * @throws RemoteError with `devices/unknown` when the id is malformed or this
   * deployment never recorded it; a failed durable delete rejects as well.
   */
  @Remote
  async revoke(id: string): Promise<void> {
    await this.ready
    const device = this.parseId(id)
    const record = this.devices.get(device)
    if (record === undefined) {
      throw new RemoteError('devices/unknown', `This deployment never recorded device ${id}.`, { id })
    }
    // Refuse immediately, before the durable delete commits: admission must not
    // wait on the medium. A failed delete puts the record back, so the roster
    // this process answers from and the roster a restart loads agree on whether
    // the device is revoked.
    this.devices.delete(device)
    this.persistedAt.delete(device)
    try {
      await this.queue(() => this.persist(device))
    } catch (error: unknown) {
      this.devices.set(device, record)
      throw error
    }
  }

  /**
   * Retire the idlest devices until the roster fits its configured cap, and
   * delete each retired record durably so a restart does not readopt it.
   *
   * Synchronous by design: the retirements are queued on the same chain
   * `settle` drains, never awaited here, because `persist` waits for the roster
   * open that this method runs inside. A refused delete is logged and left to
   * the next load, which retires again: one failed retirement must not cost the
   * process its whole roster, and the cap is what keeps the durable table
   * bounded.
   */
  private evictOverflow(): void {
    const overflow = this.devices.size - this.config.maxDevices
    if (overflow <= 0) return
    const idlest = [...this.devices.entries()]
      .map(([id, record]) => ({ id, seen: record.lastSeenAt }))
      .sort((a, b) => a.seen - b.seen || a.id.localeCompare(b.id))
      .slice(0, overflow)
    for (const { id } of idlest) {
      this.devices.delete(id)
      this.persistedAt.delete(id)
      void this.queue(() => this.persist(id)).catch((error: unknown) => {
        this.ctx.logger.warn(`device-controller: retiring device ${id} failed: ${String(error)}`)
      })
    }
  }

  /** Validate one caller-supplied device id before it addresses the roster. */
  private parseId(value: string): BrowserDeviceId {
    if (value === '' || value.length > MAX_ID_LENGTH) {
      throw new RemoteError(
        'devices/unknown',
        `A device id must be a non-empty string of at most ${String(MAX_ID_LENGTH)} characters.`,
        { id: value },
      )
    }
    return brandString<BrowserDeviceId>(value)
  }

  /** Write one device's current record without holding up its authentication. */
  private persistInBackground(id: BrowserDeviceId): void {
    void this.queue(() => this.persist(id)).catch((error: unknown) => {
      this.ctx.logger.warn(`device-controller: persisting device ${id} failed: ${String(error)}`)
    })
  }

  /** Write one device's current record, or delete it once it left the roster. */
  private async persist(id: BrowserDeviceId): Promise<void> {
    const domain = await this.ready
    const table = domain.table('devices')
    const record = this.devices.get(id)
    if (record === undefined) await table.delete(id)
    // A copy, so the record `touch` keeps mutating stays this process's own and
    // the table's snapshot does not alias a live in-memory object.
    else await table.put(id, { ...record })
  }

  /**
   * Queue one durable write behind every earlier write and the roster open.
   * The chain itself never stays rejected, so one failed write cannot skip the
   * writes after it; the caller receives the failure.
   */
  private queue<T>(work: () => Promise<T>): Promise<T> {
    const next = this.chain.then(work)
    this.chain = next.then(() => undefined, () => undefined)
    return next
  }

  /**
   * Wait for every queued durable write to land. Never rejects: `queue` already
   * absorbed each failure into the chain, so only the writes' own callers see one.
   */
  private settle(): Promise<void> {
    return this.chain.then(() => undefined)
  }
}

/**
 * Project one stored record onto the wire vocabulary.
 * @param id - device key the record is stored under.
 * @param record - the stored record, whose `lastSeenAt` is live.
 * @returns the view the Settings list renders.
 */
function deviceView(id: BrowserDeviceId, record: StoredBrowserDevice): BrowserDeviceView {
  return {
    id,
    ...(record.name === undefined ? {} : { name: record.name }),
    userAgent: record.userAgent,
    ...(record.address === undefined ? {} : { address: record.address }),
    firstSeenAt: record.firstSeenAt,
    lastSeenAt: record.lastSeenAt,
  }
}

export default DeviceController
