/** Durable browser-device records, held outside Session data. */

import { z } from 'zod'
import type { BrowserDeviceId } from '@deepseek-ai/dsh-client-connection'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'

/** One browser that exchanged the launch token, as the Host stores it. */
export interface StoredBrowserDevice {
  /** User-set label; absent while the device keeps its derived name. */
  name?: string | undefined
  /** `User-Agent` exactly as the exchange sent it. */
  userAgent: string
  /** Most recent peer address the listener observed; absent when no carrier exposed one. */
  address?: string | undefined
  /** When this device first exchanged the launch token. */
  firstSeenAt: number
  /**
   * When this device last authenticated. The roster advances the in-memory
   * record on every authenticated request and writes it back at most once a
   * minute, so a stored value may trail the live one by that interval.
   */
  lastSeenAt: number
}

/** Stored record schema; a malformed record rejects opening the domain. */
export const storedBrowserDeviceSchema = z.object({
  name: z.string().min(1).optional(),
  userAgent: z.string(),
  address: z.string().min(1).optional(),
  firstSeenAt: z.number(),
  lastSeenAt: z.number(),
}).strict()

/**
 * Authoritative browser-device storage, keyed by device id. Each device is its
 * own document: revoking or retiring one device rewrites that record alone
 * rather than the whole roster, and a roster that keeps enrolling devices
 * cannot grow one document without bound.
 */
export const browserDevicesDomain = defineDomain({
  name: 'browser_devices', version: 1, layout: 'per-record',
  tables: { devices: domainTable<BrowserDeviceId, StoredBrowserDevice>(storedBrowserDeviceSchema) },
})
