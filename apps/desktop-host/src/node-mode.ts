/** Environment for bundled package operations run by the Host's own Node-mode executable. */

import { delimiter } from 'node:path'

/**
 * Build the package-manager environment for the executable running this Host.
 *
 * `ELECTRON_RUN_AS_NODE` is added only when the Host itself is Electron. Linux runs the
 * Host on the standalone Node, where the variable describes nothing and would only
 * mislead package scripts.
 * @param bin - Directory holding the private `node` launcher, or undefined to leave PATH unchanged.
 * @returns Environment for bundled pnpm runs.
 */
export function packageManagerEnvironment(bin: string | undefined): Record<string, string> {
  return {
    ...(process.versions.electron === undefined ? {} : { ELECTRON_RUN_AS_NODE: '1' }),
    DSH_DESKTOP_NODE_EXECUTABLE: process.execPath,
    PATH: `${bin ?? ''}${delimiter}${process.env.PATH ?? ''}`,
  }
}
