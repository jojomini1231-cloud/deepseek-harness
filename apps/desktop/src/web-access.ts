/**
 * Bind arguments and the user-facing address for the Desktop Web access listener.
 * The Host child parses these through the Web profile's own flag family
 * (`packages/bundle/web-app/src/startup.ts`), so this module owns no listening behavior
 * of its own.
 */

import type { DesktopWebAccessSettings } from './settings.ts'

/**
 * The only address the Desktop listener binds. Loopback is a product decision rather
 * than a default: the harness rejects wildcard binds outright, and serving other
 * machines would put this application's remote code execution on the network.
 */
export const WEB_ACCESS_HOST = '127.0.0.1'

/**
 * Bind arguments for the Host child. A disabled setting keeps the OS-assigned port the
 * application has always used, so the application window never depends on a chosen one.
 * @param settings - the startup snapshot's Web access section.
 * @returns the `--host`/`--port` pair spliced into the child's argv.
 */
export function webAccessBindArgs(settings: DesktopWebAccessSettings): string[] {
  const port = settings.enabled ? settings.port : 0
  return ['--host', WEB_ACCESS_HOST, '--port', String(port)]
}

/**
 * The address a person types into a browser, or null while the setting is off. It never
 * carries the launch token: that credential belongs to `open()`, which hands the complete
 * authenticated URL to the operating system without crossing to the renderer.
 * @param settings - the startup snapshot's Web access section.
 * @param boundPort - the port the running Host actually bound.
 * @returns `host:port` while enabled, otherwise null.
 */
export function webAccessAddress(settings: DesktopWebAccessSettings, boundPort: number): string | null {
  return settings.enabled ? `${WEB_ACCESS_HOST}:${String(boundPort)}` : null
}

/**
 * Whether the stored section differs from the one the running Host was started with.
 * @param stored - the section as it stands in the settings document.
 * @param started - the section the running Host was started from.
 * @returns true when a restart would apply the stored section.
 */
export function webAccessRestartRequired(
  stored: DesktopWebAccessSettings,
  started: DesktopWebAccessSettings,
): boolean {
  return stored.enabled !== started.enabled || stored.port !== started.port
}
