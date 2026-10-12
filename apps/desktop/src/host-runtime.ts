/** Executable that runs the Desktop Host and the package operations it owns. */

import { join } from 'node:path'

/** One Node-mode executable and the process mode it requires. */
export interface DesktopHostRuntime {
  /** Absolute Node-mode executable. */
  readonly executable: string
  /** Whether {@link DesktopHostRuntime.executable} is Electron, which needs `ELECTRON_RUN_AS_NODE`. */
  readonly electron: boolean
}

/**
 * Select the executable that runs the Desktop Host.
 *
 * A Linux Electron process maps the system GLib from its own binary and resolves the
 * bundled libvips bindings to that copy, so the first sharp decode calls into a GType
 * the loaded libvips never registered and ends the Host with SIGSEGV
 * ([electron#46323](https://github.com/electron/electron/issues/46323)). Linux therefore
 * runs the Host on the standalone Node the primary runtime already carries, which links
 * no GLib. Other platforms keep Electron's Node mode.
 * @param platform - Platform whose Host this build launches.
 * @param electron - Electron executable in Node mode.
 * @param standalone - Bundled standalone Node executable.
 * @returns Executable that runs the Host, and whether it is Electron.
 */
export function resolveDesktopHostRuntime(
  platform: NodeJS.Platform, electron: string, standalone: string,
): DesktopHostRuntime {
  return platform === 'linux' ? { executable: standalone, electron: false } : { executable: electron, electron: true }
}

/**
 * Locate the standalone Node executable inside a prepared primary runtime.
 * @param primaryRuntime - Prepared primary runtime directory.
 * @param platform - Platform whose executable name applies.
 * @returns Absolute standalone Node executable.
 */
export function standaloneNodeExecutable(primaryRuntime: string, platform: NodeJS.Platform): string {
  return join(primaryRuntime, 'dependencies', 'node', 'bin', platform === 'win32' ? 'node.exe' : 'node')
}

/**
 * Resolve the Host runtime of a prepared or packaged Desktop build.
 * @param platform - Platform the build targets.
 * @param electron - Electron executable of that build, in Node mode.
 * @param resourcesRuntime - Physical runtime resources directory holding the primary runtime payload.
 * @returns Executable that runs the Host, and whether it is Electron.
 */
export function preparedHostRuntime(platform: NodeJS.Platform, electron: string, resourcesRuntime: string): DesktopHostRuntime {
  return resolveDesktopHostRuntime(platform, electron, standaloneNodeExecutable(join(resourcesRuntime, 'primary-runtime'), platform))
}
