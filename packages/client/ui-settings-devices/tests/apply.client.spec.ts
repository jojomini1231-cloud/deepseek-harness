/** Device-management section registration: nav entry, locale-following label, and HMR recovery. */

import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import { apply as settingsApply, inject as settingsInject } from '@deepseek-ai/dsh-client-ui-settings/client'
import { apply, inject, NS } from '../src/client/index.ts'
import { apply as hostApply } from '../src/index.ts'
import { DevicesSection } from '../src/client/DevicesSection.tsx'

afterEach(() => { vi.unstubAllGlobals() })

/** One scripted `devices` namespace the spec drives. */
function devicesFace() {
  return {
    list: vi.fn(() => Promise.resolve({ ok: true, value: [] })),
    rename: vi.fn(() => Promise.resolve({ ok: true, value: { id: 'x', userAgent: '' } })),
    revoke: vi.fn(() => Promise.resolve({ ok: true, value: undefined })),
  }
}

/** A real slot registry and locale runtime over a scripted Remote. */
async function bench(devices = devicesFace()) {
  onTestFinished(() => { /* no unmatched-call accounting on the scripted face */ })
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  locale.setLocale('zh')
  ctx.provide('locale', locale)
  new TestRemote(ctx, { devices })
  await ctx.plugin({ inject: [...settingsInject], apply: settingsApply }).await()
  return { ctx, slots: ctx.get('slots') as SlotRegistry, devices }
}

/** Declare the seats the shell owns, as ui-settings-general does in production.
 * @param slots - the registry the shell would declare into.
 * @returns the disposer withdrawing that declaration.
 */
function declare(slots: SlotRegistry): () => void {
  return slots.register(
    { name: 'root', children: { 'settings.section': { kind: 'list', scope: 'root' } } } as never,
    () => null,
  )
}

/** The injected face the registered section exposes, as the slot contract types it. */
function slotInjected(slots: SlotRegistry): Record<string, unknown> {
  return slots.entries('settings.section')[0]!.inject!()
}

describe('ui-settings-devices apply', () => {
  it('keeps the host Loader entry inert', () => {
    expect(hostApply).not.toThrow()
  })

  it('reads the roster through the mounted devices namespace', async () => {
    // The entry binds every roster call to ctx.remote.devices, so the injected
    // face reaches the Host namespace rather than a copy of it.
    const { ctx, slots, devices } = await bench()
    declare(slots)
    try {
      await ctx.plugin({ inject: [...inject], apply }).await()
      const injected = slotInjected(slots)
      await (injected.rename as (id: string, name: string) => Promise<string>)('a', 'Kitchen')
      await (injected.revoke as (id: string) => Promise<string>)('a')
      expect(devices.rename).toHaveBeenCalledWith('a', 'Kitchen')
      expect(devices.revoke).toHaveBeenCalledWith('a')
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('declares the services it uses', () => {
    expect(inject).toEqual(['slots', 'locale', 'remote', 'remote.devices'])
    expect(NS).toBe('settings.devices')
  })

  it('registers the device page for declarations before or after apply', async () => {
    const { ctx, slots } = await bench()
    declare(slots)
    try {
      await ctx.plugin({ inject: [...inject], apply }).await()
      const entry = slots.entries('settings.section')[0]!
      expect(entry.component).toBe(DevicesSection)
      expect(entry.options).toMatchObject({ id: 'devices', order: 25 })
      // The nav label follows the locale at read time.
      expect(resolveSlotLabel(entry.options.label)).toBe('设备管理')
      const injected = slotInjected(slots)
      expect(injected.hooks).toBeDefined()
      expect(typeof injected.refresh).toBe('function')
      expect(typeof injected.rename).toBe('function')
      expect(typeof injected.revoke).toBe('function')
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('removes its page when the plugin is disposed', async () => {
    const { ctx, slots } = await bench()
    declare(slots)
    try {
      const plugin = ctx.plugin({ inject: [...inject], apply })
      await plugin.await()
      expect(slots.entries('settings.section')).toHaveLength(1)
      await plugin.dispose()
      expect(slots.entries('settings.section')).toEqual([])
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('re-registers after an HMR collapse re-declares the slot', async () => {
    const { ctx, slots } = await bench()
    const undeclare = declare(slots)
    try {
      await ctx.plugin({ inject: [...inject], apply }).await()
      expect(slots.entries('settings.section')).toHaveLength(1)
      undeclare()
      expect(slots.entries('settings.section')).toEqual([])
      declare(slots)
      expect(slots.entries('settings.section')).toHaveLength(1)
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
