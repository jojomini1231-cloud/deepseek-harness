/** Client-owned observation of the optional Desktop web-access carrier. */
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { DesktopWebAccessBridge, DesktopWebAccessChoice, DesktopWebAccessStatus } from '../types.ts'

/** Framework-observed carrier state for the General Settings row. */
export class DesktopWebAccessSource {
  /** Latest accepted status; `received` distinguishes "never asked" from "off". */
  readonly store = createSnapshotStore<{ readonly status?: DesktopWebAccessStatus; readonly failed: boolean }>({ failed: false })
  private live = true
  private received = false
  private readonly unsubscribe: (() => void) | undefined

  /** @param bridge - Optional isolated Electron API, absent in ordinary browsers. */
  constructor(private readonly bridge: DesktopWebAccessBridge | undefined) {
    this.unsubscribe = bridge?.subscribe((status) => {
      if (!this.live) return
      this.received = true
      this.store.set({ status, failed: false })
    })
    void bridge?.status().then((status) => {
      if (this.live && !this.received) this.store.set({ status, failed: false })
    }, () => {
      if (this.live && !this.received) this.store.set({ failed: true })
    })
  }

  /** Whether this shell exposes the carrier at all. */
  get available(): boolean { return this.bridge !== undefined }

  /**
   * Persist one choice and adopt the carrier's answer.
   * @param next - enabled flag and port to store.
   * @returns Completion; rejection leaves the last accepted status in place.
   */
  async update(next: DesktopWebAccessChoice): Promise<void> {
    if (this.bridge === undefined) throw new Error('Desktop web access is unavailable')
    const status = await this.bridge.update(next)
    if (this.live) this.store.set({ status, failed: false })
  }

  /**
   * Ask the shell to open the running listener in this machine's browser.
   * @returns Completion; rejection means the system browser did not open.
   */
  async open(): Promise<void> {
    if (this.bridge === undefined) throw new Error('Desktop web access is unavailable')
    await this.bridge.open()
  }

  /**
   * Ask the shell to put the published, authenticated URL on the system clipboard. The
   * token it carries is spent inside the main process and never returned here.
   * @returns Completion; rejection means nothing was copied.
   */
  async copyLink(): Promise<void> {
    if (this.bridge === undefined) throw new Error('Desktop web access is unavailable')
    await this.bridge.copyLink()
  }

  /** Detach the carrier and ignore any pending status or action completion. */
  dispose(): void { this.live = false; this.unsubscribe?.() }
}
