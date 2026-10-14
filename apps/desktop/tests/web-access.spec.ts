import { expect, it } from 'vitest'
import {
  DEFAULT_WEB_ACCESS_PORT,
  MAX_WEB_ACCESS_PORT,
  MIN_WEB_ACCESS_PORT,
  isWebAccessPort,
  type DesktopWebAccessSettings,
} from '../src/settings.ts'
import {
  WEB_ACCESS_HOST,
  parseWebAccessEndpoint,
  webAccessAddress,
  webAccessBindArgs,
  webAccessLink,
  webAccessPublicAddress,
  webAccessRestartRequired,
} from '../src/web-access.ts'

const OFF: DesktopWebAccessSettings = { enabled: false, port: 4000, trustedHost: '' }

it('binds loopback only, and only the chosen port while the setting is on', () => {
  expect(webAccessBindArgs({ enabled: true, port: 4000, trustedHost: '' })).toEqual(['--host', '127.0.0.1', '--port', '4000'])
  expect(webAccessBindArgs(OFF)).toEqual(['--host', '127.0.0.1', '--port', '0'])
  expect(WEB_ACCESS_HOST).toBe('127.0.0.1')
})

it('publishes only while the setting is on, and never disturbs the listener pair', () => {
  const published: DesktopWebAccessSettings = { enabled: true, port: 4000, trustedHost: 'app.example' }
  expect(webAccessBindArgs(published)).toEqual([
    '--host', '127.0.0.1', '--port', '4000',
    '--trusted-host', 'app.example', '--public-url', 'https://app.example/',
  ])
  // A configured domain on a disabled listener binds exactly what it bound before.
  expect(webAccessBindArgs({ ...published, enabled: false })).toEqual(['--host', '127.0.0.1', '--port', '0'])
})

it('derives the fence authority and the advertised root from either accepted form', () => {
  expect(parseWebAccessEndpoint('app.example')).toEqual({ authority: 'app.example', publicUrl: 'https://app.example/' })
  expect(parseWebAccessEndpoint('app.example:8443')).toEqual({ authority: 'app.example:8443', publicUrl: 'https://app.example:8443/' })
  expect(parseWebAccessEndpoint('http://tunnel.example:8080')).toEqual({ authority: 'tunnel.example:8080', publicUrl: 'http://tunnel.example:8080/' })
  // A full URL keeps its own scheme and mount prefix; the fence sees only its authority.
  expect(parseWebAccessEndpoint('https://app.example/ui/'))
    .toEqual({ authority: 'app.example', publicUrl: 'https://app.example/ui/' })
  // A prefix without its trailing slash is normalized: the token exchange only answers
  // at the root a proxy strips to `/`, so both forms must advertise the same one.
  expect(parseWebAccessEndpoint('https://app.example/ui'))
    .toEqual({ authority: 'app.example', publicUrl: 'https://app.example/ui/' })
  // WHATWG reads a backslash as a path separator here too, so this is the same value.
  expect(parseWebAccessEndpoint('https://app.example\\ui'))
    .toEqual({ authority: 'app.example', publicUrl: 'https://app.example/ui/' })
  // Case is normalized, so the same authority is never stored twice under two spellings.
  expect(parseWebAccessEndpoint('App.Example')).toEqual({ authority: 'app.example', publicUrl: 'https://app.example/' })
  // A redundant scheme-default port is not what a browser sends, so it normalizes away
  // rather than becoming an authority the fence never matches.
  expect(parseWebAccessEndpoint('app.example:443')).toEqual({ authority: 'app.example', publicUrl: 'https://app.example/' })
  expect(parseWebAccessEndpoint('http://app.example:80')).toEqual({ authority: 'app.example', publicUrl: 'http://app.example/' })
  // A port that is not the scheme default stays part of the authority browsers send.
  expect(parseWebAccessEndpoint('http://app.example:443')).toEqual({ authority: 'app.example:443', publicUrl: 'http://app.example:443/' })
})

it('names the caller-supplied label in every rejection', () => {
  expect(() => parseWebAccessEndpoint('app example', 'web.trustedHost')).toThrow(/^web\.trustedHost /u)
  expect(() => parseWebAccessEndpoint('', 'web.trustedHost')).toThrow(/^web\.trustedHost /u)
  // The default label still names the setting the value comes from.
  expect(() => parseWebAccessEndpoint('app example')).toThrow(/^trustedHost /u)
})

it('refuses every spelling the Host fence would refuse, rather than silently rewriting it', () => {
  for (const invalid of [
    '', ' ', 'app.example ', 'app example', 'app.example\n',
    'app.example/path', 'app.example/ui/', 'app.example\\ui',
    'user@app.example', 'user:secret@app.example',
    'app.example:', 'app.example:08443', '0x7f.0.0.1', 'app.example:70000',
    'https://', 'https:///', 'https://app.example?a=1', 'https://app.example#frag',
    'ftp://app.example', 'app.example:443:80',
    // A leading dash is the shape the variadic `--trusted-host` would read as its next flag.
    '-app.example',
    // A trailing dot is the DNS root label, which a browser may drop before sending Host.
    'app.example.', 'https://app.example./',
  ]) {
    expect(() => parseWebAccessEndpoint(invalid), invalid).toThrow()
  }
})

it('names a published root only while a running listener is actually published under one', () => {
  expect(webAccessPublicAddress(OFF)).toBeNull()
  expect(webAccessPublicAddress({ enabled: true, port: 4000, trustedHost: 'app.example' }))
    .toBe('https://app.example/')
  expect(webAccessPublicAddress({ enabled: true, port: 4000, trustedHost: 'https://app.example/ui/' }))
    .toBe('https://app.example/ui/')
  // A disabled listener publishes nothing, however its stored section reads: the row
  // must not name a root beside a null local address.
  expect(webAccessPublicAddress({ enabled: false, port: 4000, trustedHost: 'app.example' })).toBeNull()
})

it('builds the published link from the running Host token, and only once a domain is live', () => {
  const published: DesktopWebAccessSettings = { enabled: true, port: 4000, trustedHost: 'app.example' }
  expect(webAccessLink(published, 'http://127.0.0.1:4000/?token=secret'))
    .toBe('https://app.example/?token=secret')
  // A mount prefix is advertised rather than routed; the token rides the advertised root.
  expect(webAccessLink({ ...published, trustedHost: 'https://app.example/ui/' }, 'http://127.0.0.1:4000/?token=secret'))
    .toBe('https://app.example/ui/?token=secret')
  expect(webAccessLink(OFF, 'http://127.0.0.1:4000/?token=secret')).toBeNull()
  expect(webAccessLink({ ...published, enabled: false }, 'http://127.0.0.1:4000/?token=secret')).toBeNull()
  // A Host that reported no token yields no link rather than an unauthenticated one.
  expect(webAccessLink(published, 'http://127.0.0.1:4000/')).toBeNull()
})

it('reports the address only while the setting runs, and never a credential', () => {
  expect(webAccessAddress({ enabled: true, port: 4000, trustedHost: '' }, 4000)).toBe('127.0.0.1:4000')
  expect(webAccessAddress({ enabled: false, port: 4000, trustedHost: '' }, 51234)).toBeNull()
})

it('asks for a restart exactly when the stored choice differs from the running one', () => {
  const running: DesktopWebAccessSettings = { enabled: true, port: 4000, trustedHost: 'app.example' }
  expect(webAccessRestartRequired(running, running)).toBe(false)
  expect(webAccessRestartRequired({ ...running, port: 4001 }, running)).toBe(true)
  expect(webAccessRestartRequired({ ...running, enabled: false }, running)).toBe(true)
  expect(webAccessRestartRequired({ ...running, trustedHost: '' }, running)).toBe(true)
  expect(webAccessRestartRequired({ ...running, trustedHost: 'other.example' }, running)).toBe(true)
})

it('accepts exactly the ports the settings row offers as drafts', () => {
  expect([MIN_WEB_ACCESS_PORT, MAX_WEB_ACCESS_PORT, DEFAULT_WEB_ACCESS_PORT]).toEqual([1, 65_535, 3080])
  for (const valid of [1, 3080, 65_535]) expect(isWebAccessPort(valid)).toBe(true)
  // 0 would hand the port back to the OS, which is the assignment this setting replaces.
  for (const invalid of [0, -1, 65_536, 3080.5, '3080', null, undefined]) expect(isWebAccessPort(invalid)).toBe(false)
})
