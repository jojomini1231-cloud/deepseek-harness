/** Public dsh commands using the immutable runtime carried by the Desktop installation. */

import { basename, dirname, join, resolve } from 'node:path'
import { runCli } from '@deepseek-ai/dsh/lib/bin.js'
import { packageManagerEnvironment } from './node-mode.ts'

/**
 * Locate the archive containing a packaged runtime.
 * @param runtimeDir - Prepared or ASAR-contained runtime directory.
 * @returns Parent archive path, or undefined for a prepared or unpacked-application directory.
 */
export function runtimeArchivePath(runtimeDir: string): string | undefined {
  const parent = dirname(runtimeDir)
  return basename(parent) === 'app.asar' ? parent : undefined
}

/**
 * Locate the packaged application containing a runtime, ASAR or unpacked.
 * Linux ships without ASAR, so its packaged runtime sits in a plain `app` directory.
 * @param runtimeDir - Prepared, ASAR-contained, or unpacked-application runtime directory.
 * @returns Parent application archive or directory, or undefined for a prepared directory.
 */
export function packagedApplicationPath(runtimeDir: string): string | undefined {
  const parent = dirname(runtimeDir)
  return basename(parent) === 'app.asar' || basename(parent) === 'app' ? parent : undefined
}

/**
 * Run the ordinary CLI with Desktop's bundled package manager and reserved-profile plugin access.
 * @param supportDir - Physical Desktop runtime directory containing the primary-runtime payload and Node launchers.
 * @returns Completion of the selected CLI command; profile plugins own their process lifetime.
 */
export async function runDesktopCli(supportDir: string): Promise<void> {
  await runCli({
    manageDesktopProfile: true,
    packageManager: {
      command: process.execPath,
      args: ['--expose-internals', join(supportDir, 'primary-runtime', 'dependencies', 'pnpm', 'bin', 'pnpm.mjs')],
      env: packageManagerEnvironment(join(supportDir, 'bin')),
    },
  })
}

if (import.meta.main) {
  if (process.platform === 'win32') {
    const { installWindowsCliSignals } = await import('./windows-cli-signals.ts')
    await installWindowsCliSignals()
  }
  const runtimeDir = resolve(import.meta.dirname, '../../../..')
  await runDesktopCli(join(dirname(packagedApplicationPath(runtimeDir) ?? runtimeDir), 'runtime'))
}
