/**
 * Startup policy for optional Electron shell preferences, independent of the Host.
 * Ownership: .agents/notes/implemented/architecture/2026-10-08-desktop-shell-configuration.md.
 *
 * `web` is read once at startup and turned into the Host child's bind arguments, so a
 * change to it takes effect the next time the application starts.
 */
import {
  DEFAULT_WEB_ACCESS_PORT, DesktopSettingsFile, saveDesktopSettings,
  type DesktopSettingsFileError, type DesktopSettingsRead, type DesktopUpdatePreferences, type DesktopWebAccessSettings,
} from './settings-file.ts'

/** Resolved popup preference and Web access section; each falls back alone, and channel failures disable neither. */
export interface DesktopSettings {
  readonly updates: Pick<DesktopUpdatePreferences, 'allowTestAuthPopupWindow'>
  readonly web: DesktopWebAccessSettings
}

const DEFAULT_WEB_ACCESS: DesktopWebAccessSettings = { enabled: false, port: DEFAULT_WEB_ACCESS_PORT, trustedHost: '' }

/**
 * Resolve the Web access section as one unit: any invalid member defaults the whole section,
 * so the listener never starts on a port or domain the user did not choose.
 * @param result - One settings read.
 * @returns The usable section, plus the failure that forced the defaults.
 */
function resolveWebAccess(result: DesktopSettingsRead): { web: DesktopWebAccessSettings; error?: DesktopSettingsFileError } {
  if (result.kind === 'missing') return { web: DEFAULT_WEB_ACCESS }
  if (result.kind === 'error') return { web: DEFAULT_WEB_ACCESS, error: result.error }
  const { enabled, port, trustedHost } = result.web
  for (const member of [enabled, port, trustedHost]) {
    if (member.kind === 'invalid') return { web: DEFAULT_WEB_ACCESS, error: member.error }
  }
  return { web: {
    enabled: enabled.kind === 'valid' ? enabled.value : DEFAULT_WEB_ACCESS.enabled,
    port: port.kind === 'valid' ? port.value : DEFAULT_WEB_ACCESS.port,
    trustedHost: trustedHost.kind === 'valid' ? trustedHost.value : DEFAULT_WEB_ACCESS.trustedHost,
  } }
}

/**
 * Report each distinct failure that forced a default; diagnostic output is best effort.
 * @param path - Settings file the failures belong to.
 * @param errors - Failures, possibly absent or repeated.
 */
function warnDefaults(path: string, ...errors: readonly (DesktopSettingsFileError | undefined)[]): void {
  for (const error of new Set(errors)) {
    if (error === undefined) continue
    try { console.warn(`desktop settings: ${path}: using defaults because settings could not be loaded`, error) } catch (_logError) {
      // Optional settings keep their defaults even when diagnostic output is unavailable.
    }
  }
}

/**
 * Initialize the shared document explicitly at startup, then resolve the popup preference and the Web access section.
 * @param userData - Electron userData, independent of DSH_HOME.
 * @returns Validated preferences, each group defaulting with a diagnostic on failure; changes require restart.
 */
export async function readDesktopSettings(userData: string): Promise<DesktopSettings> {
  const file = new DesktopSettingsFile(userData)
  const result = await file.initialize()
  const preference = result.kind === 'ready' ? result.fields.allowTestAuthPopupWindow : undefined
  const popupError = result.kind === 'error' ? result.error : preference?.kind === 'invalid' ? preference.error : undefined
  const web = resolveWebAccess(result)
  warnDefaults(file.path, popupError, web.error)
  return {
    updates: { allowTestAuthPopupWindow: preference?.kind === 'valid' ? preference.value : false },
    web: web.web,
  }
}

/**
 * Read the stored Web access section without creating or repairing the document.
 * @param userData - Electron userData, independent of DSH_HOME.
 * @returns The stored section, or the defaults with a diagnostic when it cannot be used.
 */
export async function readWebAccessSettings(userData: string): Promise<DesktopWebAccessSettings> {
  const file = new DesktopSettingsFile(userData)
  const { web, error } = resolveWebAccess(await file.read())
  warnDefaults(file.path, error)
  return web
}

/**
 * Replace the Web access section under the shared writer lock, preserving every other field.
 * A document that cannot be parsed is refused rather than overwritten, because the parts
 * this call does not own cannot be reconstructed.
 * @param userData - Electron userData, independent of DSH_HOME.
 * @param next - Validated section to store; it takes effect at the next launch.
 * @returns After a confirmed write, including logged lock-release failures.
 * @throws DesktopSettingsFileError for an unparseable document or an unchanged or uncertain write.
 */
export async function writeWebAccessSettings(userData: string, next: DesktopWebAccessSettings): Promise<void> {
  const file = new DesktopSettingsFile(userData)
  await saveDesktopSettings(file.path, () => file.saveWebAccess(next))
}
