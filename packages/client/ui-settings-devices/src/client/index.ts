/**
 * The Device management settings page, browser half: the browsers that have
 * signed in to this deployment, over the Host `devices` Remote namespace.
 *
 * The page is registered only while the Host serves that namespace, so a
 * deployment without a browser-device roster shows no trace of it.
 */

// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the shell's SlotMap merge (the 'settings.section' entry).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls the ctx.remote merge and the generated devices namespace.
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { DevicesSection } from './DevicesSection.tsx'
import { createDeviceRoster } from './device-store.ts'
import { en, zh, type DeviceSettingsLocaleKey } from './locales.ts'

export type { DevicesSectionProps } from './DevicesSection.tsx'
export type { DeviceRoster, DevicesInjected, DevicesSnapshot, DeviceWriteOutcome } from './device-store.ts'
export type { DeviceBrowserKey, DevicePlatformKey, DeviceSettingsLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Device-management settings page copy. */
    'settings.devices': DeviceSettingsLocaleKey
  }
}

/** Dictionary namespace owned by this plugin. */
export const NS = 'settings.devices'

/** Required services (cordis fiber inject). */
export const inject = ['slots', 'locale', 'remote', 'remote.devices']

/**
 * Register the Device management page once the Host serves the `devices`
 * namespace, and read the roster when the page first mounts.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-devices: copy dictionaries')
  const roster = createDeviceRoster({
    list: () => ctx.remote.devices.list(),
    rename: (id, name) => ctx.remote.devices.rename(id, name),
    revoke: id => ctx.remote.devices.revoke(id),
  })
  ctx.effect(() => () => { roster.dispose() }, 'ui-settings-devices: roster store')
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'devices',
    order: 25,
    label: () => t('nav'),
    locale: NS,
    inject: () => ({
      hooks: { devices: roster.hooks.devices },
      refresh: roster.refresh,
      rename: roster.rename,
      revoke: roster.revoke,
    }),
  }, DevicesSection))
}
