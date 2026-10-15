/**
 * Mutable browser-device registry double for Connection authentication tests.
 * It records the three calls the authentication seam makes so a spec can prove
 * where enrollment, admission, and activity reporting happen.
 */

import { brandString } from '@deepseek-ai/dsh-brand'
import type { BrowserDeviceId, BrowserDeviceSession, BrowserDeviceStore } from '../src/rpc.ts'

/** One launch-token exchange this double was asked to record. */
export interface OpenCall {
  readonly session: BrowserDeviceSession
  /** Device id this exchange was answered with. */
  readonly id: BrowserDeviceId
}

/** Device registry double with an explicit revoked set and per-call recorders. */
export class RecordBrowserDevices implements BrowserDeviceStore {
  readonly opened: OpenCall[] = []
  readonly touched: BrowserDeviceId[] = []
  readonly admitted: BrowserDeviceId[] = []
  /** Devices this double refuses to admit. */
  readonly revoked = new Set<string>()
  /** Device ids minted so far, in order, for a caller asserting reuse. */
  readonly minted: BrowserDeviceId[] = []
  /** When set, every `open` throws it, proving no cookie reaches the response. */
  failOpen: Error | undefined
  /**
   * When set, every `touch` throws it, proving admission survives a registry
   * fault. Typed `unknown` because the containment path must report a non-Error
   * throw as well as an Error one.
   */
  failTouch: unknown

  open(session: BrowserDeviceSession): BrowserDeviceId {
    if (this.failOpen !== undefined) throw this.failOpen
    // Reuse exactly what the verified cookie named, as a real registry does.
    const id = session.previous ?? brandString<BrowserDeviceId>(`device-${String(this.minted.length + 1)}`)
    if (session.previous === undefined) this.minted.push(id)
    this.opened.push({ session, id })
    return id
  }

  admits(id: BrowserDeviceId): boolean {
    this.admitted.push(id)
    return !this.revoked.has(id)
  }

  touch(id: BrowserDeviceId): void {
    if (this.failTouch !== undefined) throw this.failTouch
    this.touched.push(id)
  }
}
