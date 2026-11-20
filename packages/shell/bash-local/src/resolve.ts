/**
 * Bash executable resolution, dependency-free so non-package consumers
 * (the repository's coverage-gate probe in `vitest.config.ts`) can share the
 * ONE resolution definition with the executor and its suites — a probe that
 * resolved differently from the code under test could exempt a file whose
 * suites actually run.
 *
 * @module @deepseek-ai/dsh-bash-local/resolve
 */

import { lstatSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Well-known Git-for-Windows install locations plus PATH entries, in probing
 * order. Explicitly parameterized (env) so resolution is a pure function of
 * its inputs on every platform.
 * @param env - the environment to probe; defaults to the process environment.
 * @returns candidate `bash` executable paths in resolution order.
 */
export function candidateBashPaths(env: NodeJS.ProcessEnv = process.env): string[] {
  const programFiles = env.ProgramFiles ?? 'C:\\Program Files'
  // 32-bit Windows has no separate ProgramFiles(x86); the same directory holds Git.
  const programFilesX86 = env['ProgramFiles(x86)'] ?? programFiles
  const userHome = env.USERPROFILE ?? 'C:\\Users\\Public'
  const localAppData = env.LOCALAPPDATA ?? join(userHome, 'AppData', 'Local')
  const chocolateyInstall = env.ChocolateyInstall ?? 'C:\\ProgramData\\chocolatey'
  const candidates = [
    join(programFiles, 'Git', 'bin', 'bash.exe'),
    join(programFilesX86, 'Git', 'bin', 'bash.exe'),
    join(localAppData, 'Programs', 'Git', 'bin', 'bash.exe'),
    join(userHome, 'scoop', 'apps', 'git', 'current', 'bin', 'bash.exe'),
    join(chocolateyInstall, 'bin', 'bash.exe'),
  ]
  // Any user-added location lives on PATH; entries may carry surrounding
  // quotes from `setx`-style definitions. System32 is excluded because its
  // bash.exe is the WSL launcher, not a Windows bash: spawning it would run
  // commands inside a Linux VM instead of the Windows workspace.
  const systemRoot = env.SystemRoot ?? 'C:\\Windows'
  for (const entry of (env.PATH ?? '').split(';')) {
    const trimmed = entry.trim().replace(/^"|"$/g, '')
    if (trimmed.length === 0) continue
    if (trimmed.toLowerCase().startsWith(`${systemRoot.toLowerCase()}\\`)) continue
    candidates.push(join(trimmed, 'bash.exe'))
  }
  // The 32-bit fallback collapses onto ProgramFiles when the variable is
  // unset, and a well-known root may also sit on PATH: keep first-seen order.
  return [...new Set(candidates)]
}

/**
 * Whether a candidate can be spawned. lstat opens the entry itself instead of
 * following reparse points, so it sees the same shapes CreateProcess resolves;
 * a real directory never matches.
 */
function candidateExists(candidate: string): boolean {
  try {
    const stat = lstatSync(candidate)
    return stat.isFile() || stat.isSymbolicLink()
  } catch {
    // ENOENT (the candidate vanished between listing and probing) is the only
    // expected failure; any other error names an unspawnable path, so false
    // is the safe answer for it too.
    return false
  }
}

/**
 * The first candidate that exists on this host, for availability reporting;
 * `undefined` when no well-known install exists and only PATH resolution
 * (`'bash'`) would answer.
 * @param env - the environment to probe; defaults to the process environment.
 * @returns the first existing candidate's path, or `undefined` when none exists.
 */
export function existingBashPath(env: NodeJS.ProcessEnv = process.env): string | undefined {
  for (const candidate of candidateBashPaths(env)) {
    if (candidateExists(candidate)) return candidate
  }
  return undefined
}

/**
 * Resolve the bash executable this executor spawns.
 * @param configured - an explicit `bashPath` config value, trusted as-is.
 * @param env - the environment to probe on Windows; defaults to the process environment.
 * @param platform - the platform to resolve for; defaults to the process platform.
 * @returns the first existing well-known location on Windows (Git for Windows
 *   installs, then a non-System32 PATH entry), else `bash` for PATH resolution.
 */
export function resolveBashPath(
  configured?: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  if (configured !== undefined && configured.length > 0) return configured
  if (platform === 'win32') {
    for (const candidate of candidateBashPaths(env)) {
      if (candidateExists(candidate)) return candidate
    }
  }
  return 'bash'
}
