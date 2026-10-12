/** The installed CLI uses the shared pnpm distribution with the Host's own package-operation environment. */

import { delimiter, join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { runCli } from '@deepseek-ai/dsh/lib/bin.js'
import { runDesktopCli } from '../../desktop-host/src/cli.ts'
import { installOfficeEngineResolution } from '../../desktop-host/src/office-engine.ts'

vi.mock('@deepseek-ai/dsh/lib/bin.js', () => ({ runCli: vi.fn() }))
vi.mock('../../desktop-host/src/office-engine.ts', () => ({ installOfficeEngineResolution: vi.fn() }))

const RUNTIME = join('Application 中文 with spaces', 'resources', 'app.asar', 'dsh')
const SUPPORT = join('Application 中文 with spaces', 'resources', 'runtime')

/** Run one dispatch as though this process were an Electron Host in Node mode. */
async function asElectronHost(run: () => Promise<void>): Promise<void> {
  Object.defineProperty(process.versions, 'electron', { value: '44.7.0', configurable: true, writable: true, enumerable: true })
  try { await run() } finally { Reflect.deleteProperty(process.versions, 'electron') }
}

function expected(packageManagerEnvironment: Record<string, string>): unknown {
  return {
    manageDesktopProfile: true,
    packageManager: {
      command: process.execPath,
      args: ['--expose-internals', join(SUPPORT, 'primary-runtime', 'dependencies', 'pnpm', 'bin', 'pnpm.mjs')],
      env: packageManagerEnvironment,
    },
  }
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.clearAllMocks()
})

it.each(['system-bin', undefined])('dispatches with bundled pnpm when PATH is %s', async (path) => {
  vi.stubEnv('PATH', path)

  await runDesktopCli(RUNTIME, SUPPORT)

  expect(installOfficeEngineResolution).toHaveBeenCalledExactlyOnceWith(RUNTIME)
  expect(runCli).toHaveBeenCalledExactlyOnceWith(expected({
    DSH_DESKTOP_NODE_EXECUTABLE: process.execPath,
    PATH: `${join(SUPPORT, 'bin')}${delimiter}${path ?? ''}`,
  }))
})

it('marks Electron Node mode for an Electron Host only', async () => {
  vi.stubEnv('PATH', 'system-bin')

  await asElectronHost(() => runDesktopCli(RUNTIME, SUPPORT))

  expect(runCli).toHaveBeenCalledExactlyOnceWith(expected({
    ELECTRON_RUN_AS_NODE: '1',
    DSH_DESKTOP_NODE_EXECUTABLE: process.execPath,
    PATH: `${join(SUPPORT, 'bin')}${delimiter}system-bin`,
  }))
})
