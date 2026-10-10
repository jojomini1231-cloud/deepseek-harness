import { describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'

const { verifyDesktopRuntime } = vi.hoisted(() => ({
  verifyDesktopRuntime: vi.fn<(root: string, expected: string) => Promise<void>>(async () => undefined),
}))
// The hook imports the built tree, which a clean checkout has not produced; this is the path it resolves.
vi.mock('/apps/desktop/lib/types/runtime-tree.js', () => ({ verifyDesktopRuntime }))
vi.mock('../scripts/windows-asar-unpack.mjs', async importOriginal => ({
  ...await importOriginal<typeof import('../scripts/windows-asar-unpack.mjs')>(),
  verifyWindowsAsarUnpack: async () => undefined,
}))

const ENVIRONMENT = {
  DSH_DESKTOP_APP_ID: 'com.example.installer',
  DSH_DESKTOP_MANDATORY_UPDATE_TEST_ORIGIN: 'https://policy.example.com',
  DSH_DESKTOP_MANDATORY_UPDATE_CONFIG: JSON.stringify({ allowedAuthOrigins: ['https://login.example.com'] }),
  DSH_DESKTOP_TARGET_PLATFORM: 'win32',
  DSH_DESKTOP_TARGET_ARCH: 'x64',
  DSH_DESKTOP_UNSIGNED: '1',
  DOWNLOAD_TEST_ORIGIN: 'https://desktop-updates.example.com',
  DOWNLOAD_TEST_RELEASE_ID: '0123456789abcdef0123456789abcdef',
}

const CONTEXT = { appOutDir: 'out', packager: { getResourcesDir: () => 'out/resources' } }

/**
 * Run the packaging hook that verifies the bundled runtime.
 * @returns The version that hook required the runtime to declare.
 */
async function requiredRuntimeVersion(preparedRuntime?: string, preparedRuntimeVersion?: string): Promise<unknown> {
  verifyDesktopRuntime.mockClear()
  const { createElectronBuilderConfig } = await import('../scripts/electron-builder-config.mjs')
  const config = createElectronBuilderConfig(ENVIRONMENT, 'win32', 'x64', preparedRuntime, preparedRuntimeVersion)
  await config.afterPack(CONTEXT as never)
  return verifyDesktopRuntime.mock.calls[0]?.[1]
}

describe('packaged runtime verification', () => {
  it('requires the product version when the target tree supplies the runtime', async () => {
    const productVersion = (JSON.parse(
      await import('node:fs/promises').then(async fs => fs.readFile(new URL('../package.json', import.meta.url), 'utf8')),
    ) as { version: string }).version
    expect(await requiredRuntimeVersion()).toBe(productVersion)
  })

  it('requires the version installed-update qualification wrote into its private runtime', async () => {
    // Qualification rewrites the runtime's own version, so comparing against the product version would always fail.
    expect(await requiredRuntimeVersion('/qualification/dsh', '0.1.6-alpha.2.20260921.1')).toBe('0.1.6-alpha.2.20260921.1')
  })

  it('does not let a build version change what the bundled runtime must declare', async () => {
    const productVersion = (JSON.parse(
      await import('node:fs/promises').then(async fs => fs.readFile(new URL('../package.json', import.meta.url), 'utf8')),
    ) as { version: string }).version
    const { createElectronBuilderConfig } = await import('../scripts/electron-builder-config.mjs')
    verifyDesktopRuntime.mockClear()
    const config = createElectronBuilderConfig(
      { ...ENVIRONMENT, DSH_DESKTOP_BUILD_VERSION: `${productVersion}.20260921.1` }, 'win32', 'x64')
    expect(config.extraMetadata).toMatchObject({ version: `${productVersion}.20260921.1` })
    await config.afterPack(CONTEXT as never)
    expect(verifyDesktopRuntime.mock.calls[0]?.[1]).toBe(productVersion)
  })

  it('configures the local Linux AppImage target without update or policy metadata', async () => {
    const productVersion = (JSON.parse(
      await import('node:fs/promises').then(async fs => fs.readFile(new URL('../package.json', import.meta.url), 'utf8')),
    ) as { version: string }).version
    const { createElectronBuilderConfig } = await import('../scripts/electron-builder-config.mjs')
    verifyDesktopRuntime.mockClear()
    const environment = {
      DSH_DESKTOP_APP_ID: 'com.deepseek.harness',
      DSH_DESKTOP_TARGET_PLATFORM: 'linux',
      DSH_DESKTOP_TARGET_ARCH: 'x64',
      DSH_DESKTOP_UNSIGNED: '1',
    }
    const config = createElectronBuilderConfig(environment, 'linux', 'x64')
    expect(config.linux).toMatchObject({ category: 'Development', executableName: 'deepseek-harness', target: ['AppImage'] })
    // Linux ships unpacked, so the kit's engine probe sees real directories and its WASM fallback works.
    expect(config.asar).toBe(false)
    expect(config.artifactName).toBe('deepseek-harness-${version}-${os}-${arch}-unsigned.${ext}')
    expect(config.publish).toBeNull()
    expect(config.extraMetadata).not.toHaveProperty('dshMandatoryUpdatePolicy')
    expect(config.directories.output).toContain(join('targets', 'linux-x64', 'unsigned-artifacts'))
    await config.afterPack(CONTEXT as never)
    expect(verifyDesktopRuntime.mock.calls[0]).toEqual([
      expect.any(String), productVersion, { platform: 'linux', arch: 'x64' },
    ])
  })
})
