/**
 * Browser-safe vocabulary of the device roster this package serves. Values
 * carry no authentication material: the device id names a row, and the signed
 * cookie that authenticates it never crosses this wire.
 *
 * @module @deepseek-ai/dsh-api-device-controller/types
 */

/** One browser that reached this deployment, as a device list reads it. */
export interface BrowserDeviceView {
  /** Opaque device identity; also the key the revoke and rename calls address. */
  readonly id: string
  /** User-set label; absent while the device keeps its derived name. */
  readonly name?: string | undefined
  /** `User-Agent` exactly as the launch-token exchange sent it. */
  readonly userAgent: string
  /** Peer address the receiving listener observed; absent when the carrier exposed none. */
  readonly address?: string | undefined
  /** When this device first exchanged the launch token. */
  readonly firstSeenAt: number
  /** When this device last authenticated. */
  readonly lastSeenAt: number
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** The caller addressed a device this deployment never recorded. */
    'devices/unknown': {
      readonly id: string
    }
    /** The request was well formed but the roster refused it. */
    'devices/rejected': {
      readonly id: string
    }
  }
}
