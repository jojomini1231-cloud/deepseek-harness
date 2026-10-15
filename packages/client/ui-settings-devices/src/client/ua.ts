/**
 * Derive a device's display name from the User-Agent its exchange sent.
 *
 * Parsing produces structured values, never copy: the page's dictionary names
 * the resulting browser and system in the interface language, and a device the
 * operator renamed keeps that label instead.
 *
 * @module @deepseek-ai/dsh-client-ui-settings-devices/ua
 */

import type { DeviceBrowserKey, DevicePlatformKey } from './locales.ts'

/** Browser and system one User-Agent names, as the page's dictionary keys. */
export interface DerivedDeviceName {
  /** Browser family, or `other` when the string names none the page knows. */
  readonly browser: DeviceBrowserKey
  /** Operating system, or `other` when the string names none the page knows. */
  readonly platform: DevicePlatformKey
}

/**
 * Name the browser and system behind one stored User-Agent.
 * @param userAgent - `User-Agent` exactly as the exchange sent it.
 * @returns the dictionary keys naming that browser and system.
 */
export function deriveDeviceName(userAgent: string): DerivedDeviceName {
  return { browser: browserOf(userAgent), platform: platformOf(userAgent) }
}

/**
 * Browser family, most specific first: Chromium derivatives also claim Chrome,
 * and every Chromium browser after Safari, so order decides the answer.
 */
function browserOf(userAgent: string): DeviceBrowserKey {
  if (/Edg[A-Z]?\//u.test(userAgent)) return 'edge'
  if (/Firefox\//u.test(userAgent)) return 'firefox'
  if (/Chrome\//u.test(userAgent) || /Chromium\//u.test(userAgent)) return 'chrome'
  if (/Safari\//u.test(userAgent)) return 'safari'
  return 'other'
}

/** Operating system, checked most specific first: iOS also claims macOS, Android also claims Linux. */
function platformOf(userAgent: string): DevicePlatformKey {
  if (/iPhone|iPad|iPod/u.test(userAgent)) return 'ios'
  if (/Android/u.test(userAgent)) return 'android'
  if (/Mac OS X|Macintosh/u.test(userAgent)) return 'macos'
  if (/Windows/u.test(userAgent)) return 'windows'
  if (/Linux|X11/u.test(userAgent)) return 'linux'
  return 'other'
}
