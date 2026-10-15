/**
 * The device roster's behavior: what a launch-token exchange records, how
 * revocation answers authentication, and what the Remote namespace returns.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { BrowserDeviceId } from '@deepseek-ai/dsh-client-connection'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import DeviceController from '../src/index.ts'
import { harness } from './harness.ts'
import type { DeviceHarness } from './harness.ts'
import { MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import type { MemoryMediaPool } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'

const UA = 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/141.0 Safari/537.36'

afterEach(() => { vi.useRealTimers() })

function id(value: string): BrowserDeviceId {
  return brandString<BrowserDeviceId>(value)
}

/** Run one test body against a fresh controller, disposing it afterwards. */
async function withHarness(
  run: (h: DeviceHarness) => Promise<void>,
  options?: Parameters<typeof harness>[0],
): Promise<void> {
  const h = await harness(options)
  try {
    await run(h)
  } finally {
    await h.dispose()
  }
}

/** The durable `devices` rows this deployment recorded. */
function durableRows(h: DeviceHarness): Record<string, unknown> {
  return Object.fromEntries(h.pool.media.get('browser_devices')?.tables.get('devices') ?? [])
}

describe('device roster', () => {
  it('mints an opaque identity for the browser that exchanged the token', async () => {
    await withHarness(async ({ controller, store }) => {
      const device = store().open({ userAgent: UA })
      expect(device).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u)
      expect(store().admits(device)).toBe(true)
      expect(await controller.list()).toHaveLength(1)
    })
  })

  it('lists every recorded device most recently active first', async () => {
    vi.useFakeTimers()
    try {
      await withHarness(async ({ controller, store }) => {
        vi.setSystemTime(new Date('2026-08-24T00:00:00.000Z'))
        const first = store().open({ userAgent: 'First/1' })
        vi.setSystemTime(new Date('2026-08-24T00:01:00.000Z'))
        const second = store().open({ userAgent: 'Second/2' })
        const rows = await controller.list()
        expect(rows.map(row => row.id)).toEqual([second, first])
        expect(rows.map(row => row.userAgent)).toEqual(['Second/2', 'First/1'])
        expect(rows[0]!.firstSeenAt).toBe(rows[0]!.lastSeenAt)
        expect(rows[0]!.name).toBeUndefined()
        expect(rows[0]!.address).toBeUndefined()
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps the peer address the receiving listener observed', async () => {
    await withHarness(async ({ controller, store }) => {
      store().open({ userAgent: UA, address: '10.0.0.7' })
      expect((await controller.list())[0]!.address).toBe('10.0.0.7')
    })
  })

  it('reuses the device a verified cookie already names and refreshes its facts', async () => {
    await withHarness(async ({ controller, store }) => {
      const device = store().open({ userAgent: 'Old/1', address: '10.0.0.1' })
      const repeated = store().open({ userAgent: UA, address: '10.0.0.2', previous: device })
      expect(repeated).toBe(device)
      const rows = await controller.list()
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ id: device, userAgent: UA, address: '10.0.0.2' })
    })
  })

  it('keeps the last observed peer address when a repeat exchange exposes none', async () => {
    await withHarness(async ({ controller, store }) => {
      // A carrier that exposes no peer socket is not a moved device, so the
      // address it last reported stands rather than being erased.
      const device = store().open({ userAgent: UA, address: '10.0.0.1' })
      store().open({ userAgent: UA, previous: device })
      expect((await controller.list())[0]!.address).toBe('10.0.0.1')
    })
  })

  it('enrolls a fresh device when the cookie names one this deployment no longer knows', async () => {
    await withHarness(async ({ controller, store }) => {
      // A revoked browser returns with the printed URL; its old id is gone.
      const replacement = store().open({ userAgent: UA, previous: id('deleted-device') })
      expect(replacement).not.toBe('deleted-device')
      expect(await controller.list()).toHaveLength(1)
    })
  })

  it('reports activity in memory and ignores it for a device it does not hold', async () => {
    await withHarness(async ({ controller, store }) => {
      const device = store().open({ userAgent: UA })
      const enrolled = (await controller.list())[0]!.lastSeenAt
      store().touch(device)
      expect((await controller.list())[0]!.lastSeenAt).toBeGreaterThanOrEqual(enrolled)
      expect(() => { store().touch(id('unknown')) }).not.toThrow()
      expect(await controller.list()).toHaveLength(1)
    })
  })

  it('refuses a device once it is revoked and drops its record for good', async () => {
    await withHarness(async ({ controller, store }) => {
      const device = store().open({ userAgent: UA })
      await controller.revoke(device)
      expect(store().admits(device)).toBe(false)
      expect(await controller.list()).toEqual([])
      // Revoking again addresses nothing: the row is gone, not tombstoned.
      await expect(controller.revoke(device)).rejects.toMatchObject({ code: 'devices/unknown' })
    })
  })

  it('reports a failed revoke and leaves the device admitted, as a restart would', async () => {
    await withHarness(async (h) => {
      const device = h.store().open({ userAgent: UA })
      // Drain the enrollment write, so the injected failure lands on the delete.
      await h.controller.list()
      h.pool.failNextWrites = 1
      await expect(h.controller.revoke(device)).rejects.toBeTruthy()
      // The revocation this call reports as failed is one the process keeps
      // answering from and a restart keeps reading: memory and medium agree.
      expect(h.store().admits(device)).toBe(true)
      expect(await h.controller.list()).toHaveLength(1)
      expect(durableRows(h)[device]).toBeDefined()
    })
  })

  it('leaves a restart reading a device whose durable delete failed', async () => {
    const first = await harness()
    const pool = first.pool
    const device = first.store().open({ userAgent: UA })
    await first.controller.list()
    pool.failNextWrites = 1
    await expect(first.controller.revoke(device)).rejects.toBeTruthy()
    await first.dispose()

    const second = await harness({ pool })
    try {
      expect(second.store().admits(device)).toBe(true)
      expect((await second.controller.list()).map(row => row.id)).toEqual([device])
    } finally {
      await second.dispose()
    }
  })

  it('labels a device and clears the label back to the derived name', async () => {
    await withHarness(async ({ controller, store }) => {
      const device = store().open({ userAgent: UA })
      expect((await controller.rename(device, '  Kitchen laptop  ')).name).toBe('Kitchen laptop')
      expect((await controller.list())[0]!.name).toBe('Kitchen laptop')
      expect((await controller.rename(device, '   ')).name).toBeUndefined()
      const [cleared] = await controller.list()
      expect(cleared!.name).toBeUndefined()
      // A label edit preserves the facts the exchange observed.
      expect(cleared!.userAgent).toBe(UA)
    })
  })

  it('refuses an over-long label without changing the record', async () => {
    await withHarness(async ({ controller, store }) => {
      const device = store().open({ userAgent: UA })
      await controller.rename(device, 'ok')
      await expect(controller.rename(device, 'x'.repeat(65))).rejects.toMatchObject({ code: 'devices/rejected' })
      expect((await controller.list())[0]!.name).toBe('ok')
    })
  })

  it('bounds a label in UTF-8 bytes rather than code units', async () => {
    await withHarness(async ({ controller, store }) => {
      const device = store().open({ userAgent: UA })
      // U+10348 is four UTF-8 bytes and two UTF-16 code units, so sixteen of
      // them sit exactly on the byte bound while seventeen exceed it — a bound
      // counted in code units would accept the longer one.
      const astral = '𐍈'
      expect((await controller.rename(device, astral.repeat(16))).name).toHaveLength(32)
      await expect(controller.rename(device, astral.repeat(17)))
        .rejects.toMatchObject({ code: 'devices/rejected' })
    })
  })

  it('refuses an unknown or malformed device id on both writes', async () => {
    await withHarness(async ({ controller }) => {
      for (const bad of ['', 'missing-device', 'x'.repeat(129)]) {
        await expect(controller.rename(bad, 'x')).rejects.toMatchObject({ code: 'devices/unknown' })
        await expect(controller.revoke(bad)).rejects.toMatchObject({ code: 'devices/unknown' })
      }
    })
  })

  it('writes an exchange and a revoke through to the durable table', async () => {
    await withHarness(async (h) => {
      const kept = h.store().open({ userAgent: UA, address: '10.0.0.7' })
      const dropped = h.store().open({ userAgent: 'Gone/2' })
      await h.controller.revoke(dropped)
      const rows = durableRows(h)
      expect(rows[kept]).toMatchObject({ userAgent: UA, address: '10.0.0.7' })
      expect(rows[dropped]).toBeUndefined()
    })
  })

  it('survives a restart with the roster and its revocations intact', async () => {
    const first = await harness()
    const pool = first.pool
    const kept = first.store().open({ userAgent: 'Kept/1' })
    await first.controller.rename(kept, 'Kept')
    const revoked = first.store().open({ userAgent: 'Revoked/2' })
    await first.controller.revoke(revoked)
    // Unload drains the background exchange write, so nothing is dropped.
    await first.dispose()

    const second = await harness({ pool })
    try {
      const rows = await second.controller.list()
      expect(rows.map(row => row.id)).toEqual([kept])
      expect(rows[0]!.name).toBe('Kept')
      expect(second.store().admits(revoked)).toBe(false)
      expect(second.store().admits(kept)).toBe(true)
      // An adopted device has no live persist timestamp yet, so its first
      // report persists immediately rather than waiting out the interval.
      second.store().touch(kept)
      expect((await second.controller.list())[0]!.id).toBe(kept)
    } finally {
      await second.dispose()
    }
  })

  it('admits a device that enrolled before the durable roster loaded', async () => {
    // The seam is attached synchronously, so authentication can ask before the
    // durable read resolves. Nothing has been revoked in this process yet.
    await withHarness(async ({ store }) => {
      expect(store().admits(store().open({ userAgent: UA }))).toBe(true)
    })
  })

  it('refuses an unknown device once a stalled load outlasts the grace window', async () => {
    // A browser revoked by an earlier process has no row here, so admitting it
    // while the roster stays unread would readmit exactly what was revoked.
    vi.useFakeTimers()
    try {
      const seeded = await harness()
      const revoked = seeded.store().open({ userAgent: 'Revoked/1' })
      await seeded.controller.list()
      await seeded.controller.revoke(revoked)
      await seeded.dispose()

      const held = Promise.withResolvers<undefined>()
      const stalled = await harness({ pool: seeded.pool, holdOpen: held.promise })
      try {
        const attach = stalled.store()
        expect(attach.admits(revoked)).toBe(true)
        // Past the grace the unread roster stops admitting what it has not read.
        vi.advanceTimersByTime(10_000)
        expect(attach.admits(revoked)).toBe(false)
        // A device this process enrolled itself is never the revoked one.
        expect(attach.admits(attach.open({ userAgent: UA }))).toBe(true)
      } finally {
        held.resolve(undefined)
        await stalled.dispose()
      }
    } finally {
      vi.useRealTimers()
    }
  })

  it('refuses every device when the roster cannot open at all', async () => {
    // A definite open failure is a definite answer: nothing is admitted.
    vi.useFakeTimers()
    try {
      const seeded = await harness()
      seeded.pool.versions.set('browser_devices', 99)
      await seeded.dispose()

      const h = await harness({ pool: seeded.pool })
      try {
        await expect(h.controller.list()).rejects.toBeTruthy()
        vi.advanceTimersByTime(10_000)
        expect(h.store().admits(id('never-recorded'))).toBe(false)
      } finally {
        await h.dispose()
      }
    } finally {
      vi.useRealTimers()
    }
  })

  it('honors the configured grace window for a roster that stays unread', async () => {
    vi.useFakeTimers()
    try {
      const held = Promise.withResolvers<undefined>()
      const h = await harness({ holdOpen: held.promise, config: { rosterLoadGraceMs: 2_500 } })
      try {
        const unrecorded = id('never-recorded')
        expect(h.store().admits(unrecorded)).toBe(true)
        // The configured window, not the shipped default, is what closes it.
        vi.advanceTimersByTime(2_499)
        expect(h.store().admits(unrecorded)).toBe(true)
        vi.advanceTimersByTime(1)
        expect(h.store().admits(unrecorded)).toBe(false)
      } finally {
        held.resolve(undefined)
        await h.dispose()
      }
    } finally {
      vi.useRealTimers()
    }
  })

  it('detaches the browser-device registry when the controller unloads', async () => {
    // The attach is a registry contribution, so unloading must observe removal
    // rather than merely stop answering.
    const h = await harness()
    expect(h.carrier.attached).toBeDefined()
    await h.dispose()
    expect(h.carrier.attached).toBeUndefined()
  })

  it('stays unactivated in a deployment that composes no browser carrier', async () => {
    // The row is served only where a browser carrier exists. Without one the
    // plugin waits for `connection` instead of recording against nothing, so it
    // provides no service and its injects never resolve.
    const ctx = new Context()
    await ctx.plugin(Storage)
    const facility = new DomainFacility(ctx, { backend: 'fixture' })
    ctx.provide('storageDomain', facility)
    const fiber = ctx.plugin(DeviceController)
    expect(fiber.state).toBe(0)
    expect(ctx.get('deviceController')).toBeUndefined()
    await fiber.dispose()
    await facility.closeAll()
  })
})

describe('device roster cap', () => {
  /**
   * Enroll `count` devices on one medium, each a minute younger than the last,
   * then hand back the pool a capped controller starts over. Seeding in an
   * earlier process leaves the load path the only writer, so a retirement is
   * the only write a case has to account for.
   * @param count - devices to enroll.
   * @param sameInstant - enroll every device in the same millisecond, leaving
   * the id as the only tie-break a retirement has.
   * @returns the shared pool and the ids in enrollment order.
   */
  async function seed(
    count: number,
    sameInstant = false,
  ): Promise<{ pool: MemoryMediaPool; ids: BrowserDeviceId[] }> {
    vi.useFakeTimers()
    const seeded = await harness()
    const ids: BrowserDeviceId[] = []
    for (let index = 0; index < count; index += 1) {
      vi.setSystemTime(new Date(Date.UTC(2026, 7, 24, 0, sameInstant ? 0 : index)))
      ids.push(seeded.store().open({ userAgent: `Device/${String(index)}` }))
    }
    await seeded.controller.list()
    // Every seeded device is on the medium before the seeded process goes away.
    expect(Object.keys(durableRows(seeded))).toHaveLength(count)
    await seeded.dispose()
    return { pool: seeded.pool, ids }
  }

  it('retires the idlest stored device down to the configured cap when the roster loads', async () => {
    const { pool, ids } = await seed(3)
    try {
      const capped = await harness({ pool, config: { maxDevices: 2 } })
      try {
        expect((await capped.controller.list()).map(row => row.id)).toEqual([ids[2], ids[1]])
        // The retirement reaches the medium, so no later load readopts it.
        expect(durableRows(capped)[ids[0]!]).toBeUndefined()
        expect(durableRows(capped)[ids[1]!]).toBeDefined()
        expect(capped.store().admits(ids[0]!)).toBe(false)
      } finally {
        await capped.dispose()
      }
    } finally {
      vi.useRealTimers()
    }
  })

  it('retires the idlest device when an enrollment goes past the cap', async () => {    const { pool, ids } = await seed(2)
    try {
      const capped = await harness({ pool, config: { maxDevices: 2 } })
      try {
        vi.setSystemTime(new Date('2026-08-24T00:10:00.000Z'))
        const enrolled = capped.store().open({ userAgent: 'Device/3' })
        expect((await capped.controller.list()).map(row => row.id)).toEqual([enrolled, ids[1]])
        expect(durableRows(capped)[ids[0]!]).toBeUndefined()
        expect(durableRows(capped)[enrolled]).toBeDefined()
      } finally {
        await capped.dispose()
      }
    } finally {
      vi.useRealTimers()
    }
  })

  it('breaks a tie in last-active time by id when retiring', async () => {
    // Three devices enrolled in the same millisecond leave the id as the only
    // ordering a retirement has.
    const { pool, ids } = await seed(3, true)
    try {
      const capped = await harness({ pool, config: { maxDevices: 2 } })
      try {
        const retired = [...ids].sort((a, b) => a.localeCompare(b))[0]!
        expect((await capped.controller.list()).map(row => row.id)).not.toContain(retired)
        expect(durableRows(capped)[retired]).toBeUndefined()
      } finally {
        await capped.dispose()
      }
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps serving the roster when the medium refuses a retirement', async () => {
    const { pool, ids } = await seed(3)
    try {
      // The refusal is armed on the `devices` delete itself: a pool-wide write
      // counter would race the writes the roster's own open makes.
      const backend = new MemoryStorageBackend(pool)
      const open = backend.kv.open.bind(backend.kv)
      let armed = true
      backend.kv.open = async (descriptor) => {
        const unit = await open(descriptor)
        const remove = unit.deleteRecord.bind(unit)
        unit.deleteRecord = async (table, key) => {
          if (armed && table === 'devices') {
            armed = false
            throw new Error('injected delete failure')
          }
          await remove(table, key)
        }
        return unit
      }

      let warn = vi.fn()
      // Installed before the controller exists, so the load path's own
      // retirement is what the spy observes.
      const capped = await harness({
        pool,
        backend,
        config: { maxDevices: 2 },
        beforeController: (ctx) => { warn = vi.spyOn(ctx.logger, 'warn'); return Promise.resolve() },
      })
      try {
        // One failed retirement must not cost the process its whole roster.
        expect((await capped.controller.list()).map(row => row.id)).toEqual([ids[2], ids[1]])
        expect(warn).toHaveBeenCalled()
        expect(durableRows(capped)[ids[0]!]).toBeDefined()
      } finally {
        await capped.dispose()
      }

      // The next load retires what the medium kept, so the cap still holds.
      const retried = await harness({ pool, config: { maxDevices: 2 } })
      try {
        await retried.controller.list()
        expect(durableRows(retried)[ids[0]!]).toBeUndefined()
      } finally {
        await retried.dispose()
      }
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('device roster coalescing', () => {
  it('persists a later activity report once the interval elapsed', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-24T00:00:00.000Z'))
    try {
      await withHarness(async (h) => {
        const device = h.store().open({ userAgent: UA })
        await h.controller.list()
        const enrolled = durableRows(h)[device]
        // Past the interval, the live time reaches the medium.
        vi.setSystemTime(new Date('2026-08-24T00:02:00.000Z'))
        h.store().touch(device)
        await h.controller.list()
        expect(durableRows(h)[device]).not.toEqual(enrolled)
        expect(durableRows(h)[device]).toMatchObject({ lastSeenAt: Date.now() })
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('adopts a store the roster already held before this process started', async () => {
    // Seed the medium, then start a controller over it, so the durable read
    // finds a device the live process has never seen.
    const seeded = await harness()
    const pool = seeded.pool
    const device = seeded.store().open({ userAgent: 'Earlier/1' })
    await seeded.controller.list()
    await seeded.dispose()

    const restarted = await harness({ pool })
    try {
      expect(restarted.store().admits(device)).toBe(true)
      expect((await restarted.controller.list()).map(row => row.userAgent)).toEqual(['Earlier/1'])
    } finally {
      await restarted.dispose()
    }
  })

  it('persists a second activity report within the interval', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-24T00:00:00.000Z'))
    try {
      await withHarness(async (h) => {
        const device = h.store().open({ userAgent: UA })
        // Drain the exchange's own write first, so the comparison below sees
        // only what the activity report did or did not add.
        await h.controller.list()
        const written = durableRows(h)[device]
        vi.setSystemTime(new Date('2026-08-24T00:00:30.000Z'))
        h.store().touch(device)
        await h.controller.list()
        expect(durableRows(h)[device]).toEqual(written)
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('reports activity the coalesced write has not reached the medium with yet', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-24T00:00:00.000Z'))
    try {
      await withHarness(async (h) => {
        const device = h.store().open({ userAgent: UA })
        await h.controller.list()
        const written = durableRows(h)[device]
        vi.setSystemTime(new Date('2026-08-24T00:00:30.000Z'))
        h.store().touch(device)
        // The list reads the live stamp, so a page left open does not date the
        // device from the last write the interval let through.
        expect((await h.controller.list())[0]!.lastSeenAt).toBe(Date.now())
        expect(durableRows(h)[device]).toEqual(written)
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('clears a label from a device that reported a peer address', async () => {
    await withHarness(async ({ controller, store }) => {
      const device = store().open({ userAgent: UA, address: '10.0.0.7' })
      await controller.rename(device, 'Kitchen')
      // Clearing keeps an address the roster still knows.
      expect((await controller.rename(device, '')).address).toBe('10.0.0.7')
    })
  })

  it('orders two devices that were last active in the same millisecond by id', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-24T00:00:00.000Z'))
    try {
      await withHarness(async ({ controller, store }) => {
        const first = store().open({ userAgent: 'First/1' })
        const second = store().open({ userAgent: 'Second/2' })
        // Equal last-active times fall through to the id tie-break.
        const ids = (await controller.list()).map(row => row.id)
        expect(ids).toEqual([first, second].sort((a, b) => a.localeCompare(b)))
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('writes an enrollment that raced the durable open, and adopts a stored one', async () => {
    // The seam attaches synchronously and `open` answers from memory, so a
    // device can enroll while the durable read is still in flight. The pre-seeded
    // row covers the other direction: a record this process never saw.
    const seeded = await harness()
    const pool = seeded.pool
    const stored = seeded.store().open({ userAgent: 'Stored/1' })
    await seeded.controller.list()
    await seeded.dispose()

    let open = (): void => {}
    const held = new Promise<void>((resolve) => { open = resolve })
    const raced = await harness({ pool, holdOpen: held })
    try {
      const enrolling = raced.store().open({ userAgent: 'Raced/2' })
      open()
      const rows = await raced.controller.list()
      expect(rows.map(row => row.userAgent).sort()).toEqual(['Raced/2', 'Stored/1'])
      expect(durableRows(raced)[enrolling]).toMatchObject({ userAgent: 'Raced/2' })
      expect(raced.store().admits(stored)).toBe(true)
    } finally {
      await raced.dispose()
    }
  })

  it('logs a failed background write and keeps serving the roster it holds', async () => {
    await withHarness(async ({ ctx, controller, store, pool }) => {
      const warn = vi.spyOn(ctx.logger, 'warn')
      pool.failNextWrites = 1
      store().open({ userAgent: UA })
      await controller.list()
      expect(warn).toHaveBeenCalled()
      // The row is still held in memory, so the page keeps showing the device.
      expect(await controller.list()).toHaveLength(1)
    })
  })
})
