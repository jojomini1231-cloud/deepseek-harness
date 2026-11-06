/** Shared shell settings storage; reads have no side effects and fields fail independently. */
import { appendFileSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { z } from 'zod'
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

/** Desktop Web access preferences, stored as the document's `web` section. */
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

const preferencesSchema = z.object({
  allowTestAuthPopupWindow: z.boolean(),
  channel: z.enum(['nightly', 'stable']),
})
const webAccessSchema = z.object({
  enabled: z.boolean(),
  port: z.number().int().min(MIN_WEB_ACCESS_PORT).max(MAX_WEB_ACCESS_PORT),
  // An unusable domain is reported here, where consumers apply their defaults; spent while
  // building the Host child's argv, a hand-edited typo would abort startup instead.
  trustedHost: z.string().refine(value => value === '' || isWebAccessEndpoint(value)),
})
const documentSchema = z.looseObject({ updates: z.looseObject({}).optional(), web: z.looseObject({}).optional() })

function isWebAccessEndpoint(value: string): boolean {
  try { parseWebAccessEndpoint(value) } catch (_error) {
    // Like every field failure, an unusable domain is reported by field name alone.
    return false
  }
  return true
}

/** Known field values before consumers supply defaults for absent fields. */
export type DesktopUpdatePreferences = z.infer<typeof preferencesSchema>
/** Unknown root, updates, and web fields survive a read-modify-write operation. */
export type DesktopSettingsDocument = z.infer<typeof documentSchema>
/** Handling-relevant failure details; validation failures never include document contents. */
export type DesktopSettingsProblem =
  | { kind: 'read' }
  | { kind: 'invalid'; reason: 'json' | 'structure' }
  | { kind: 'invalid'; reason: 'field'; field: keyof DesktopUpdatePreferences | keyof DesktopWebAccessSettings }
  | { kind: 'write'; operation: 'initialize' | 'save'; effect: 'unchanged' | 'unknown' | 'written' }

/** A storage or validation failure; business consumers decide fallback or suspension. */
export class DesktopSettingsFileError extends Error {
  /**
   * @param problem - Stable failure classification and mutation outcome, when applicable.
   * @param path - Settings file location, never file contents.
   * @param options - Original filesystem error, when available.
   */
  constructor(readonly problem: DesktopSettingsProblem, readonly path: string, options?: ErrorOptions) {
    super(`desktop settings: ${problem.kind}: ${path}`, options)
  }
}

/** Absence permits a caller default; an invalid explicit field does not. */
export type DesktopSettingsField<T> =
  | { kind: 'absent' }
  | { kind: 'valid'; value: T }
  | { kind: 'invalid'; error: DesktopSettingsFileError }

/**
 * File state and independent field results; a missing file is never implicitly created.
 * `fields` holds the `updates` section and `web` the Web access section.
 */
export type DesktopSettingsRead =
  | { kind: 'missing' }
  | { kind: 'error'; error: DesktopSettingsFileError }
  | {
    kind: 'ready'
    document: DesktopSettingsDocument
    fields: { [K in keyof DesktopUpdatePreferences]: DesktopSettingsField<DesktopUpdatePreferences[K]> }
    web: { [K in keyof DesktopWebAccessSettings]: DesktopSettingsField<DesktopWebAccessSettings[K]> }
  }

function field<T>(schema: z.ZodType<T>, value: unknown, name: keyof DesktopUpdatePreferences | keyof DesktopWebAccessSettings,
  path: string): DesktopSettingsField<T> {
  if (value === undefined) return { kind: 'absent' }
  const result = schema.safeParse(value)
  return result.success ? { kind: 'valid', value: result.data }
    : { kind: 'invalid', error: new DesktopSettingsFileError({ kind: 'invalid', reason: 'field', field: name }, path) }
}

/**
 * Validate a channel at the IPC boundary using the same schema as file loading.
 * @param value - Untrusted input.
 * @returns Whether the input is a supported channel.
 */
export function isDesktopUpdateChannel(value: unknown): value is DesktopUpdatePreferences['channel'] {
  return preferencesSchema.shape.channel.safeParse(value).success
}

/**
 * Validate a Web access port at the IPC boundary using the same schema as file loading.
 * @param value - Untrusted input.
 * @returns Whether the input is an integer from {@link MIN_WEB_ACCESS_PORT} through {@link MAX_WEB_ACCESS_PORT}.
 */
export function isWebAccessPort(value: unknown): value is number {
  return webAccessSchema.shape.port.safeParse(value).success
}

/**
 * Resolve the document shared by shell preferences and update channels.
 * @param userData - Electron userData, independent of Host and DSH_HOME.
 * @returns Settings file path without filesystem changes.
 */
function desktopSettingsPath(userData: string): string {
  return join(userData, 'desktop', 'settings.json')
}

/** Sections one save replaces; omitted sections and keys remain unchanged. */
type DesktopSettingsPatch = {
  readonly updates?: Partial<DesktopUpdatePreferences>
  readonly web?: DesktopWebAccessSettings
}

/** File operations do not watch, cache, choose defaults or apply runtime preferences. */
export class DesktopSettingsFile {
  readonly path: string

  /** @param userData - Electron userData, independent of Host and DSH_HOME. */
  constructor(userData: string) { this.path = desktopSettingsPath(userData) }

  /** @returns Fresh file and field states; performs no creation or repair. */
  async read(): Promise<DesktopSettingsRead> {
    let raw: string
    try { raw = await readFile(this.path, 'utf8') } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'missing' }
      return { kind: 'error', error: new DesktopSettingsFileError({ kind: 'read' }, this.path, { cause: error }) }
    }
    let value: unknown
    try { value = JSON.parse(raw) } catch (_error) {
      // SyntaxError can quote user content; diagnostics expose only the file and failure category.
      return { kind: 'error', error: new DesktopSettingsFileError({ kind: 'invalid', reason: 'json' }, this.path) }
    }
    return this.inspect(value)
  }

  private inspect(value: unknown): DesktopSettingsRead {
    const result = documentSchema.safeParse(value)
    if (!result.success) return { kind: 'error', error: new DesktopSettingsFileError({ kind: 'invalid', reason: 'structure' }, this.path) }
    const document = result.data
    return { kind: 'ready', document, fields: {
      allowTestAuthPopupWindow: field(preferencesSchema.shape.allowTestAuthPopupWindow,
        document.updates?.allowTestAuthPopupWindow, 'allowTestAuthPopupWindow', this.path),
      channel: field(preferencesSchema.shape.channel, document.updates?.channel, 'channel', this.path),
    }, web: {
      enabled: field(webAccessSchema.shape.enabled, document.web?.enabled, 'enabled', this.path),
      port: field(webAccessSchema.shape.port, document.web?.port, 'port', this.path),
      trustedHost: field(webAccessSchema.shape.trustedHost, document.web?.trustedHost, 'trustedHost', this.path),
    } }
  }

  /**
   * Explicit startup initialization; existing files, including invalid ones, are never replaced.
   * @returns Current file state after exclusive creation if missing, or a structured failure.
   */
  async initialize(): Promise<DesktopSettingsRead> {
    const current = await this.read()
    if (current.kind !== 'missing') return current
    try { return await this.mutate({ kind: 'initialize' }) } catch (error) {
      if (!(error instanceof DesktopSettingsFileError)) throw error
      return { kind: 'error', error }
    }
  }

  /**
   * Patch known fields under the shared writer lock, preserving unknown and unrelated invalid fields.
   * Malformed JSON/structure is rejected; a missing document starts empty. External editors must
   * not write concurrently. No runtime settings change here. Write errors distinguish unchanged,
   * uncertain write completion, and a committed write whose lock cleanup failed; no rollback is attempted.
   * @param updates - Typed fields to replace; omitted keys remain unchanged.
   * @returns After atomic replacement and lock release; otherwise throws DesktopSettingsFileError.
   */
  async saveUpdates(updates: Partial<DesktopUpdatePreferences>): Promise<void> {
    const result = await this.mutate({ kind: 'save', patch: { updates } })
    if (result.kind === 'error') throw result.error
  }

  /**
   * Replace the Web access fields with the same locking, preservation, and failure classification
   * as {@link saveUpdates}; unknown `web` fields survive.
   * @param web - Complete validated section to store.
   * @returns After atomic replacement and lock release; otherwise throws DesktopSettingsFileError.
   */
  async saveWebAccess(web: DesktopWebAccessSettings): Promise<void> {
    const result = await this.mutate({ kind: 'save', patch: { web } })
    if (result.kind === 'error') throw result.error
  }

  private async mutate(request: { kind: 'initialize' } | { kind: 'save'; patch: DesktopSettingsPatch }): Promise<DesktopSettingsRead> {
    let effect: 'unchanged' | 'unknown' | 'written' = 'unchanged'
    try {
      await mkdir(dirname(this.path), { recursive: true, mode: 0o700 })
      return await withFileLock(this.path, async () => {
        const current = await this.read()
        if (current.kind === 'error') throw current.error
        if (request.kind === 'initialize' && current.kind !== 'missing') return current
        const document = current.kind === 'ready' ? current.document : {}
        // A first launch writes the Web access section so its fields are discoverable in the file.
        const patch: DesktopSettingsPatch = request.kind === 'save' ? request.patch : {
          updates: { allowTestAuthPopupWindow: false },
          web: { enabled: false, port: DEFAULT_WEB_ACCESS_PORT, trustedHost: '' },
        }
        const next = {
          ...document,
          ...(patch.updates === undefined ? {} : { updates: { ...document.updates, ...patch.updates } }),
          ...(patch.web === undefined ? {} : { web: { ...document.web, ...patch.web } }),
        }
        const raw = `${JSON.stringify(next, null, 2)}\n`
        effect = 'unknown'
        if (request.kind === 'initialize') {
          try { await writeFile(this.path, raw, { flag: 'wx', mode: 0o600 }) } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
            effect = 'unchanged'
            return this.read()
          }
        } else {
          await writeFileAtomic(this.path, raw, { mode: 0o600 })
        }
        effect = 'written'
        return this.inspect(next)
      })
    } catch (error) {
      if (error instanceof DesktopSettingsFileError) throw error
      throw new DesktopSettingsFileError({ kind: 'write', operation: request.kind, effect }, this.path, { cause: error })
    }
  }
}

/**
 * Run one explicit UI save under the shared failure policy. A confirmed write is accepted even when
 * lock cleanup failed afterwards; unchanged and uncertain writes reject without retry. Every write
 * failure is appended to `settings.json.save.jsonl` beside the document.
 * @param path - Settings file the save targets.
 * @param save - One {@link DesktopSettingsFile} save call.
 * @returns After a confirmed write, including logged lock-release failures.
 */
export async function saveDesktopSettings(path: string, save: () => Promise<void>): Promise<void> {
  try { await save() } catch (error) {
    if (!(error instanceof DesktopSettingsFileError) || error.problem.kind !== 'write') throw error
    const entry = { time: new Date().toISOString(), event: 'settings-save-failed', effect: error.problem.effect,
      path, reason: error.cause instanceof Error ? error.cause.message : String(error.cause) }
    try { appendFileSync(`${path}.save.jsonl`, `${JSON.stringify(entry)}\n`, { mode: 0o600, flush: true }) } catch (logError) {
      console.error('desktop settings: could not persist save warning', entry, logError)
    }
    if (error.problem.effect !== 'written') throw error
  }
}
