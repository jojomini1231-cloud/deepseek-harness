/** Child-process environment for a Node-mode runtime, with private shell launchers scoped to package installation. */

import { delimiter } from 'node:path'
import type { DesktopHostRuntime } from './host-runtime.ts'

/**
 * Build the environment a Node-mode executable runs in.
 * @param runtime - Executable and mode selected for the child process.
 * @param bin - Directory containing the node shell launcher, or undefined to keep it off PATH.
 * @param environment - Caller environment preserved for plugin execution.
 * @returns Environment for a Node-mode child process.
 */
export function desktopNodeEnvironment(
  runtime: DesktopHostRuntime, bin: string | undefined, environment: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  return {
    ...environment,
    ...(runtime.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
    ...(bin === undefined ? {} : { DSH_DESKTOP_NODE_EXECUTABLE: runtime.executable, PATH: `${bin}${delimiter}${environment.PATH ?? ''}` }),
  }
}
