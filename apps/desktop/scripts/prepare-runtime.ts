/** Prepare Desktop resources and publish their versions after every preparation stage succeeds. */

import { execFileSync } from 'node:child_process'
import { chmodSync, cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { downloadArtifact } from '@electron/get'
import extractZip from 'extract-zip'
import { readPrimaryRuntime } from '../../../packages/skill/tool-workspace-dependencies/src/index.ts'
import { desktopTargetPlatform, resolveDesktopBuildTarget, resolveDesktopTargetBuildPaths } from './desktop-build-paths.mjs'
import { resolveDesktopHostRuntime, standaloneNodeExecutable } from '../src/host-runtime.ts'
import { packagingStep } from './packaging-step.mjs'
import { preparePrimaryRuntime } from './prepare-primary-runtime.ts'
import { prepareDesktopCli } from './prepare-cli.ts'
import { prepareCommandLink } from './prepare-command-link.ts'

const BUILD_PATHS = resolveDesktopTargetBuildPaths()
const RUNTIME_ROOT = BUILD_PATHS.runtime

type DesktopTarget = ReturnType<typeof desktopTargetPlatform>

/** Extract the target Electron distribution and return its Node-mode executable. */
async function prepareElectron({ platform, arch }: DesktopTarget): Promise<string> {
  const require = createRequire(import.meta.url)
  const { version } = require('electron/package.json') as { version: string }
  const archive = await packagingStep(process.env.DSH_DESKTOP_PACKAGING_RUN_DIR, 'download:electron',
    () => downloadArtifact({ version, platform, arch, artifactName: 'electron', cacheRoot: BUILD_PATHS.downloads }))
  rmSync(BUILD_PATHS.electron, { recursive: true, force: true })
  await packagingStep(process.env.DSH_DESKTOP_PACKAGING_RUN_DIR, 'extract:electron', () => extractZip(archive, { dir: BUILD_PATHS.electron }))
  return join(BUILD_PATHS.electron,
    platform === 'win32' ? 'electron.exe' : platform === 'darwin' ? 'Electron.app/Contents/MacOS/Electron' : 'electron')
}

/** Read the Node version an Electron distribution reports in Node mode. */
function electronNodeVersion(executable: string): string {
  return execFileSync(executable, ['-p', 'process.versions.node'], {
    encoding: 'utf8', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  }).trim()
}

function prepareCli({ platform, arch }: DesktopTarget): void {
  // The Windows batch wrapper is meaningless elsewhere, so only the POSIX shell script ships on Unix targets.
  cpSync(join(import.meta.dirname, 'node-bin', 'node'), join(RUNTIME_ROOT, 'bin', 'node'))
  if (platform === 'win32') cpSync(join(import.meta.dirname, 'node-bin', 'node.cmd'), join(RUNTIME_ROOT, 'bin', 'node.cmd'))
  if (platform !== 'win32') chmodSync(join(RUNTIME_ROOT, 'bin', 'node'), 0o755)
  const cli = join(RUNTIME_ROOT, 'cli')
  prepareDesktopCli(cli, platform)
  if (platform === 'darwin') {
    const minimumVersion = execFileSync('/usr/libexec/PlistBuddy', [
      '-c', 'Print LSMinimumSystemVersion', join(BUILD_PATHS.electron, 'Electron.app', 'Contents', 'Info.plist'),
    ], { encoding: 'utf8' }).trim()
    prepareCommandLink(cli, arch, minimumVersion)
  }
  cpSync(join(import.meta.dirname, '..', 'lib', 'command-manager-entry.js'), join(cli, 'command-manager.js'))
  cpSync(join(import.meta.dirname, 'command-path.ps1'), join(cli, 'command-path.ps1'))
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { 'defer-primary-runtime-smoke': { type: 'boolean', default: false } } })
  const target = desktopTargetPlatform(resolveDesktopBuildTarget())
  rmSync(RUNTIME_ROOT, { recursive: true, force: true })
  mkdirSync(RUNTIME_ROOT, { recursive: true })
  const electron = await prepareElectron(target)
  await packagingStep(process.env.DSH_DESKTOP_PACKAGING_RUN_DIR, 'prepare:primary-runtime',
    () => preparePrimaryRuntime({ deferSmoke: values['defer-primary-runtime-smoke'] }))
  const primaryRuntime = join(RUNTIME_ROOT, 'primary-runtime')
  const { node, pnpm } = await readPrimaryRuntime(primaryRuntime)
  if (node === undefined) throw new Error('desktop runtime: primary-runtime manifest has no Node version')
  if (pnpm === undefined) throw new Error('desktop runtime: primary-runtime manifest has no pnpm version')
  const host = resolveDesktopHostRuntime(target.platform, electron, standaloneNodeExecutable(primaryRuntime, target.platform))
  await packagingStep(process.env.DSH_DESKTOP_PACKAGING_RUN_DIR, 'prepare:cli', async () => { prepareCli(target) })
  writeFileSync(join(RUNTIME_ROOT, 'versions.json'), `${JSON.stringify({
    schemaVersion: 1,
    // The Node version that executes the Host: Electron's Node, except where the Host runs
    // on the bundled Node because Electron cannot load the Host's libvips bindings.
    node: host.electron ? electronNodeVersion(electron) : node,
    pnpm,
  }, undefined, 2)}\n`)
}

await main()
