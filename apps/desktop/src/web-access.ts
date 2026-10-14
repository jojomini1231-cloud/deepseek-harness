/**
 * Bind arguments and the user-facing addresses for the Desktop Web access listener.
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

/** One external authority this listener is published under, split into the flags that carry it. */
export interface WebAccessEndpoint {
  /** Bare `host[:port]` authority the browser-trust fence accepts. */
  readonly authority: string
  /** Canonical HTTP(S) root a browser opens, normalized to end in `/`. */
  readonly publicUrl: string
}

/**
 * Parse the stored external authority into the pair of flags that publish this listener
 * under it. A bare `host[:port]` derives its `https://` root; an absolute `http(s)://`
 * URL keeps its own scheme, port, and mount prefix, and contributes only its authority
 * to the trust fence, because `--public-url` grants no trust. A mount prefix is
 * advertised, never routed: the proxy must strip it, and the launch-token exchange only
 * answers at that root.
 *
 * The authority is the URL host, which is what a browser puts in `Host` for the
 * advertised root: a scheme-default port is not part of it, and accepting one would
 * store an authority the fence then never matches.
 * @param value - the stored `web.trustedHost` text, never empty.
 * @param label - name this value is reported under, so a caller prefixes its own field
 *   or setting name the way `parsePublicUrl` does.
 * @returns the fence authority and the advertised root.
 * @throws Error naming the reason.
 */
export function parseWebAccessEndpoint(value: string, label = 'trustedHost'): WebAccessEndpoint {
  if (value === '') throw new Error(`${label} must name a host`)
  if (/[\u0000-\x20\u007f]/u.test(value)) {
    throw new Error(`${label} must not contain whitespace or control characters`)
  }
  const absolute = /^https?:\/\//iu.test(value)
  if (absolute && (value.includes('?') || value.includes('#'))) {
    throw new Error(`${label} must not include a query or fragment (? or #)`)
  }
  const prefix = absolute ? value : `https://${value}`
  const [rawAuthority = ''] = prefix.slice(prefix.indexOf('://') + 3).split(/[/\\]/, 1)
  if (rawAuthority === '') throw new Error(`${label} must name a host`)
  if (rawAuthority.includes('@')) {
    throw new Error(`${label} must not include credentials (a username or password before @)`)
  }
  let url: URL
  try {
    // http: and https: are WHATWG "special schemes": parsing yields a non-empty hostname or throws.
    url = new URL(prefix)
  } catch {
    throw new Error(`${label} must be a host or an absolute http(s):// URL`)
  }
  // A value WHATWG would silently rewrite is a typo that must fail loudly: it would leave
  // requests failing unexplained, or grant an authority the browser never sends. IDN
  // hosts are declared in punycode, the form the wire carries. A redundant scheme-default
  // port is the one rewrite that is not a typo, and it normalizes away.
  const written = rawAuthority.toLowerCase()
  const defaultPort = url.protocol === 'https:' ? '443' : '80'
  if (written !== url.host && written !== `${url.host}:${defaultPort}`) {
    throw new Error(`${label} must be a host[:port] or an http(s):// URL without a path, credentials, or non-canonical spelling`)
  }
  // A leading dash would be read as the start of the next flag by the variadic
  // `--trusted-host` this value becomes.
  if (written.startsWith('-')) throw new Error(`${label} must not begin with a dash`)
  // A trailing dot is the DNS root label: browsers may drop it before sending `Host`, so
  // the authority would match only by accident.
  if (url.host.endsWith('.')) throw new Error(`${label} must not end with a dot`)
  if (!absolute && url.pathname !== '/') {
    throw new Error(`${label} must name only a host[:port]; give an http(s):// URL to include a mount prefix`)
  }
  // The launch-token exchange only answers at the root a proxy strips to `/`, so an
  // advertised prefix must be written with its trailing slash. WHATWG leaves a non-empty
  // path as written, and the child normalizes it, so the row and the copied link would
  // otherwise show a root that authenticates nowhere.
  if (url.pathname !== '/' && !url.pathname.endsWith('/')) url.pathname += '/'
  return { authority: url.host, publicUrl: absolute ? url.href : `${url.origin}/` }
}

/**
 * Bind arguments for the Host child. A disabled setting keeps the OS-assigned port the
 * application has always used, so the application window never depends on a chosen one.
 * @param settings - the startup snapshot's Web access section.
 * @returns the `--host`/`--port` pair, plus the publishing pair when one is configured,
 *   spliced into the child's argv.
 * @throws Error when the stored {@link DesktopWebAccessSettings.trustedHost} is unusable.
 */
export function webAccessBindArgs(settings: DesktopWebAccessSettings): string[] {
  const port = settings.enabled ? settings.port : 0
  const args = ['--host', WEB_ACCESS_HOST, '--port', String(port)]
  if (!settings.enabled || settings.trustedHost === '') return args
  const endpoint = parseWebAccessEndpoint(settings.trustedHost)
  return [...args, '--trusted-host', endpoint.authority, '--public-url', endpoint.publicUrl]
}

/**
 * The address a person types into a browser on this machine, or null while the setting
 * is off. It never carries the launch token: that credential belongs to `open()` and
 * `webAccessLink()`, which spend it in the main process without crossing to the renderer.
 * @param settings - the startup snapshot's Web access section.
 * @param boundPort - the port the running Host actually bound.
 * @returns `host:port` while enabled, otherwise null.
 */
export function webAccessAddress(settings: DesktopWebAccessSettings, boundPort: number): string | null {
  return settings.enabled ? `${WEB_ACCESS_HOST}:${String(boundPort)}` : null
}

/**
 * The external root this listener is published under, for the row to display. Like
 * {@link webAccessAddress} it describes the running listener, so a disabled one has
 * nothing published to name.
 * @param settings - the section the running Host was started from.
 * @returns the advertised root while one is configured, otherwise null.
 */
export function webAccessPublicAddress(settings: DesktopWebAccessSettings): string | null {
  if (!settings.enabled || settings.trustedHost === '') return null
  return parseWebAccessEndpoint(settings.trustedHost).publicUrl
}

/**
 * The complete authenticated URL for the authority a browser actually reaches this
 * listener through. A remote browser holds no usable cookie: the session cookie is
 * host-only and bound to the authority it was minted on, so it must repeat the launch
 * token exchange on that authority, at the advertised root the proxy strips to `/`.
 * @param settings - the section the running Host was started from.
 * @param hostUrl - the authenticated URL the running Host reported.
 * @returns the URL to open elsewhere, or null while this listener is not published.
 */
export function webAccessLink(settings: DesktopWebAccessSettings, hostUrl: string): string | null {
  const publicAddress = webAccessPublicAddress(settings)
  if (publicAddress === null) return null
  const token = new URL(hostUrl).searchParams.get('token')
  if (token === null) return null
  const url = new URL(publicAddress)
  url.searchParams.set('token', token)
  return url.href
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
    || stored.trustedHost !== started.trustedHost
}
