/**
 * Local Electron shell settings, loaded once per process independently of the Host.
 * Ownership: .agents/notes/implemented/architecture/2026-10-08-desktop-shell-configuration.md.
 *
 * `web` is read once at startup and turned into the Host child's bind arguments, so a
 * change to it takes effect the next time the application starts.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { parseWebAccessEndpoint } from './web-access.ts'

/**
 * Port bounds the shell accepts. 0 is excluded because it would hand the port back to
 * the OS, which is exactly the private assignment this setting exists to replace. The
 * settings row validates the same range before a draft crosses the wire; the shell is
 * the authority, and `apps/desktop/tests/web-access.spec.ts` pins the agreement.
 */
export const MIN_WEB_ACCESS_PORT = 1

/** Highest port a listener may bind; the top of the TCP port range. */
export const MAX_WEB_ACCESS_PORT = 65535

/** Port offered before the user chooses one; the Web profile's own default. */
export const DEFAULT_WEB_ACCESS_PORT = 3080

/** Desktop Web access preferences. */
export interface DesktopWebAccessSettings {
  /** Serve the Web UI on `127.0.0.1:port` for this machine's browsers. */
  readonly enabled: boolean
  /** Port the listener binds while {@link enabled}; ignored while it is false. */
  readonly port: number
  /**
   * One external authority this listener is published under, or empty for none. A bare
   * `host[:port]` derives its `https://` root; an absolute `http(s)://` URL also carries
   * the mount prefix a proxy strips.
   */
  readonly trustedHost: string
}

/** Resolved shell preferences; absent fields use the defaults without rewriting existing files. */
export interface DesktopSettings {
  readonly updates: {
    readonly allowTestAuthPopupWindow: boolean
  }
  readonly web: DesktopWebAccessSettings
}

const DEFAULT_WEB_ACCESS: DesktopWebAccessSettings = {
  enabled: false, port: DEFAULT_WEB_ACCESS_PORT, trustedHost: '',
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Whether `value` is a usable port for this setting. */
export function isWebAccessPort(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value)
    && value >= MIN_WEB_ACCESS_PORT && value <= MAX_WEB_ACCESS_PORT
}

/** The settings document carried beside the other Desktop userData files. */
function settingsPath(userData: string): string {
  return join(userData, 'desktop', 'settings.json')
}

/** The shell's default preferences, as a fresh document. */
function defaults(): DesktopSettings {
  return { updates: { allowTestAuthPopupWindow: false }, web: { ...DEFAULT_WEB_ACCESS } }
}

/**
 * Read one Web access section, accepting an absent one as the default.
 * @param value - the document's `web` member.
 * @returns the validated section.
 * @throws Error naming the offending field.
 */
function webAccessSection(value: unknown): DesktopWebAccessSettings {
  if (value === undefined) return { ...DEFAULT_WEB_ACCESS }
  if (!record(value)) throw new Error('web must be an object')
  const enabled = value.enabled
  if (enabled !== undefined && typeof enabled !== 'boolean') {
    throw new Error('web.enabled must be true or false')
  }
  const port = value.port
  if (port !== undefined && !isWebAccessPort(port)) {
    throw new Error(`web.port must be an integer from ${String(MIN_WEB_ACCESS_PORT)} through ${String(MAX_WEB_ACCESS_PORT)}`)
  }
  const trustedHost = value.trustedHost
  if (trustedHost !== undefined && typeof trustedHost !== 'string') {
    throw new Error('web.trustedHost must be a string')
  }
  // An unusable value is reported here, where the document-level fallback applies. Left
  // to the boot that spends it, a hand-edited typo would abort startup instead.
  if (trustedHost !== undefined && trustedHost !== '') {
    parseWebAccessEndpoint(trustedHost, 'web.trustedHost')
  }
  return {
    enabled: enabled ?? false,
    port: port ?? DEFAULT_WEB_ACCESS_PORT,
    trustedHost: trustedHost ?? '',
  }
}

/**
 * Read shell settings, creating the default document exclusively when missing.
 * @param userData - Electron's userData directory, independent of DSH_HOME.
 * @returns Validated settings, or defaults when reading, creating or validating fails; changes require a restart.
 */
export function readDesktopSettings(userData: string): DesktopSettings {
  const directory = join(userData, 'desktop')
  const path = settingsPath(userData)
  const fallback = defaults()
  try {
    let raw: string
    try { raw = readFileSync(path, 'utf8') } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      mkdirSync(directory, { recursive: true, mode: 0o700 })
      try { writeFileSync(path, `${JSON.stringify(fallback, null, 2)}\n`, { flag: 'wx', mode: 0o600 }) } catch (error) {
        // An existing document belongs to the user, including one created during initialization.
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      }
      raw = readFileSync(path, 'utf8')
    }
    const value: unknown = JSON.parse(raw)
    if (!record(value) || (value.updates !== undefined && !record(value.updates))) {
      throw new Error('expected a JSON object with an optional updates object')
    }
    const allow = value.updates?.allowTestAuthPopupWindow
    if (allow !== undefined && typeof allow !== 'boolean') {
      throw new Error('updates.allowTestAuthPopupWindow must be true or false')
    }
    return { updates: { allowTestAuthPopupWindow: allow ?? false }, web: webAccessSection(value.web) }
  } catch (error) {
    try {
      console.warn(`desktop settings: ${path}: using defaults because settings could not be loaded`, error)
    } catch (_logError) {
      // Diagnostic output is best effort; its failure must not make optional settings fatal.
      // TODO: Persist settings diagnostics when console output is unavailable, without blocking startup.
    }
    return fallback
  }
}

/**
 * Replace the Web access section, leaving every other part of the document intact.
 * A document that cannot be parsed is refused rather than overwritten, because the
 * parts this call does not own cannot be reconstructed.
 * @param userData - Electron's userData directory, independent of DSH_HOME.
 * @param next - the section to store.
 * @returns Completion of the atomic replacement.
 * @throws Error when the stored document is unreadable, not JSON, or not a JSON object.
 */
export async function writeWebAccessSettings(userData: string, next: DesktopWebAccessSettings): Promise<void> {
  const path = settingsPath(userData)
  let document: Record<string, unknown> = {}
  let raw: string | undefined
  try {
    raw = readFileSync(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw new Error(`desktop settings: cannot read ${path}: ${(error as Error).message}`)
    }
  }
  if (raw !== undefined) {
    const parsed: unknown = JSON.parse(raw)
    if (!record(parsed)) throw new Error(`desktop settings: ${path} is not a JSON object`)
    document = parsed
  }
  const stored = {
    ...document,
    web: { enabled: next.enabled, port: next.port, trustedHost: next.trustedHost },
  }
  await writeFileAtomic(path, `${JSON.stringify(stored, null, 2)}\n`, { mode: 0o600, dirMode: 0o700 })
}
