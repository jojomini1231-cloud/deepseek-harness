/**
 * Choose a temporary directory that packaging subprocesses can actually use.
 *
 * A host can expose a temporary directory that a non-administrator may write a named file into
 * yet cannot enumerate, which is what Windows does with `C:\WINDOWS\TEMP` for an unelevated user.
 * NSIS writes its preprocessor output through `!tempfile` and reads it back by `!include`, and
 * electron-builder's NSIS run fails at the last step when that include cannot be found. The probe
 * below exercises the create, list, read, and delete cycle so the packaging run can fall back to a
 * directory under the build output instead of failing minutes into the installer step.
 */

import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** Content the probe writes and expects to read back unchanged. */
const PROBE_CONTENT = 'dsh packaging temp probe\n'

/**
 * Prove a directory supports the create, enumerate, read, and delete cycle packaging tools need.
 * @param {string} directory Absolute directory path.
 * @returns {string | undefined} Failure detail, or `undefined` when packaging can use the directory.
 */
export function temporaryDirectoryFailure(directory) {
  const name = `dsh-temp-probe-${randomUUID()}`
  const file = join(directory, name)
  let outcome
  try {
    mkdirSync(directory, { recursive: true })
    writeFileSync(file, PROBE_CONTENT)
    outcome = readdirSync(directory).includes(name)
      ? readFileSync(file, 'utf8') === PROBE_CONTENT
        ? undefined
        : `${directory} returned different content than the probe wrote`
      : `${directory} does not list the probe file it accepted`
  }
  catch (error) {
    outcome = `${directory} rejected the probe: ${error instanceof Error ? error.message : String(error)}`
  }
  finally {
    try {
      rmSync(file, { force: true })
    }
    catch (error) {
      // The answer is whether packaging can use the directory; a probe file the host will not remove does not change it.
      if (!(error instanceof Error)) throw error
    }
  }
  return outcome
}

/**
 * Select the first candidate whose temporary directory survives the probe.
 * @param {readonly { label: string, directory: string | undefined }[]} candidates Ordered candidates; the caller supplies a final fallback it owns.
 * @returns {{ directory: string, failures: readonly string[] }} The usable directory and the rejected candidates.
 * @throws when no candidate is usable.
 */
export function resolvePackagingTempDirectory(candidates) {
  const failures = []
  for (const { label, directory } of candidates) {
    if (directory === undefined || directory === '') continue
    const failure = temporaryDirectoryFailure(directory)
    if (failure === undefined) return { directory, failures }
    failures.push(`${label} (${failure})`)
  }
  const described = failures.length === 0
    ? '  no temporary directory is configured'
    : failures.map(failure => `  ${failure}`).join('\n')
  throw new Error(`desktop package: no temporary directory is usable for packaging, so NSIS cannot stage its scripts:\n${described}`)
}
