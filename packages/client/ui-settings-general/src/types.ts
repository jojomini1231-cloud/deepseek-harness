/** Type-only Electron update declarations shared by the settings UI and Desktop compatibility checks. */

/** Classified failure copy selected by the Web locale without exposing raw updater diagnostics. */
export type DesktopUpdateFailureKind =
  | 'check'
  | 'check-network'
  | 'download'
  | 'download-network'
  | 'install'
  | 'install-network'
  | 'stop-failed'
  | 'tasks-changed'
  | 'tasks-unavailable'
  | 'fullscreen-timeout'

/** Public semantic preload fields consumed by the settings row. */
export interface DesktopUpdatePresentation {
  readonly phase: 'idle' | 'checking' | 'available' | 'downloading' | 'verifying' | 'installing' | 'ready' | 'error'
  readonly version?: string
  readonly percent?: number
  readonly failure?: DesktopUpdateFailureKind
}

/** Optional carrier API; it cannot select artifacts or authorize installation. */
export interface DesktopUpdateBridge {
  status(): Promise<DesktopUpdatePresentation>
  open(): Promise<void>
  subscribe(listener: (state: DesktopUpdatePresentation) => void): () => void
}

/** Shared carrier status for the account row and collapsed sidebar badge. */
export interface DesktopUpdateView {
  readonly presentation?: DesktopUpdatePresentation
  readonly failed: boolean
  readonly opening: boolean
}

/** Web access preferences as the row writes them. */
export interface DesktopWebAccessChoice {
  readonly enabled: boolean
  readonly port: number
  /** One external authority to publish the listener under, or empty for none. */
  readonly trustedHost: string
}

/** Web access state as the row renders it. `address` never carries the launch token. */
export interface DesktopWebAccessStatus extends DesktopWebAccessChoice {
  readonly address: string | null
  /** Advertised root this listener is published under; also never carries the launch token. */
  readonly publicAddress: string | null
  readonly restartRequired: boolean
}

/** Optional carrier API; it can open or copy the Host's browser URL but never receives its token. */
export interface DesktopWebAccessBridge {
  status(): Promise<DesktopWebAccessStatus>
  update(next: DesktopWebAccessChoice): Promise<DesktopWebAccessStatus>
  open(): Promise<void>
  copyLink(): Promise<void>
  subscribe(listener: (status: DesktopWebAccessStatus) => void): () => void
}
