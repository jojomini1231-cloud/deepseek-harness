import { expect, it } from 'vitest'
import {
  DEFAULT_WEB_ACCESS_PORT,
  MAX_WEB_ACCESS_PORT,
  MIN_WEB_ACCESS_PORT,
  isWebAccessPort,
} from '../src/settings.ts'
import { WEB_ACCESS_HOST, webAccessAddress, webAccessBindArgs, webAccessRestartRequired } from '../src/web-access.ts'

it('binds loopback only, and only the chosen port while the setting is on', () => {
  expect(webAccessBindArgs({ enabled: true, port: 4000 })).toEqual(['--host', '127.0.0.1', '--port', '4000'])
  expect(webAccessBindArgs({ enabled: false, port: 4000 })).toEqual(['--host', '127.0.0.1', '--port', '0'])
  expect(WEB_ACCESS_HOST).toBe('127.0.0.1')
})

it('reports the address only while the setting runs, and never a credential', () => {
  expect(webAccessAddress({ enabled: true, port: 4000 }, 4000)).toBe('127.0.0.1:4000')
  expect(webAccessAddress({ enabled: false, port: 4000 }, 51234)).toBeNull()
})

it('asks for a restart exactly when the stored choice differs from the running one', () => {
  expect(webAccessRestartRequired({ enabled: true, port: 4000 }, { enabled: true, port: 4000 })).toBe(false)
  expect(webAccessRestartRequired({ enabled: true, port: 4001 }, { enabled: true, port: 4000 })).toBe(true)
  expect(webAccessRestartRequired({ enabled: true, port: 4000 }, { enabled: false, port: 4000 })).toBe(true)
})

it('accepts exactly the ports the settings row offers as drafts', () => {
  expect([MIN_WEB_ACCESS_PORT, MAX_WEB_ACCESS_PORT, DEFAULT_WEB_ACCESS_PORT]).toEqual([1, 65_535, 3080])
  for (const valid of [1, 3080, 65_535]) expect(isWebAccessPort(valid)).toBe(true)
  // 0 would hand the port back to the OS, which is the assignment this setting replaces.
  for (const invalid of [0, -1, 65_536, 3080.5, '3080', null, undefined]) expect(isWebAccessPort(invalid)).toBe(false)
})
