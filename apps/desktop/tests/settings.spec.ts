import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import * as fs from 'node:fs'
import * as fsp from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, onTestFinished, vi } from 'vitest'
import { DEFAULT_WEB_ACCESS_PORT, DesktopSettingsFile, DesktopSettingsFileError } from '../src/settings-file.ts'
import { readDesktopSettings, readWebAccessSettings, writeWebAccessSettings } from '../src/settings.ts'

vi.mock('node:fs/promises', async importOriginal => ({ ...await importOriginal<typeof import('node:fs/promises')>() }))

beforeEach(() => { vi.spyOn(console, 'warn').mockImplementation(() => {}) })
afterEach(() => { vi.restoreAllMocks() })

const WEB_DEFAULTS = { enabled: false, port: DEFAULT_WEB_ACCESS_PORT, trustedHost: '' }

function fixture() {
  const userData = mkdtempSync(join(tmpdir(), 'dsh-desktop-settings-'))
  onTestFinished(() => { rmSync(userData, { recursive: true, force: true }) })
  const directory = join(userData, 'desktop')
  mkdirSync(directory)
  return { userData, path: join(directory, 'settings.json') }
}

it('creates a discoverable default file on first launch without touching other preferences', async () => {
  const { userData, path } = fixture()
  rmSync(join(userData, 'desktop'), { recursive: true })
  writeFileSync(join(userData, 'keybindings.json'), 'existing shortcuts\n')
  expect(await readDesktopSettings(userData)).toEqual({ updates: { allowTestAuthPopupWindow: false }, web: WEB_DEFAULTS })
  expect(readFileSync(path, 'utf8')).toBe('{\n  "updates": {\n    "allowTestAuthPopupWindow": false\n  },\n  "web": {\n    "enabled": false,\n    "port": 3080,\n    "trustedHost": ""\n  }\n}\n')
  expect(readFileSync(join(userData, 'keybindings.json'), 'utf8')).toBe('existing shortcuts\n')
})

it.each(['{}', '{"updates": {}}', '{"other": 1, "updates": {"other": true}}'])('defaults an older document without rewriting it: %s', async (raw) => {
  const { userData, path } = fixture()
  writeFileSync(path, raw)
  expect((await readDesktopSettings(userData)).updates.allowTestAuthPopupWindow).toBe(false)
  expect(readFileSync(path, 'utf8')).toBe(raw)
})

it('loads explicit opt-in and opt-out on the next read without changing an earlier process snapshot', async () => {
  const { userData, path } = fixture()
  for (const allow of [true, false]) {
    const raw = JSON.stringify({ updates: { allowTestAuthPopupWindow: allow }, custom: 'preserve' })
    writeFileSync(path, raw)
    expect((await readDesktopSettings(userData)).updates.allowTestAuthPopupWindow).toBe(allow)
    expect(readFileSync(path, 'utf8')).toBe(raw)
  }
  const previous = await readDesktopSettings(userData)
  writeFileSync(path, '{"updates":{"allowTestAuthPopupWindow":true}}')
  expect(previous.updates.allowTestAuthPopupWindow).toBe(false)
  expect((await readDesktopSettings(userData)).updates.allowTestAuthPopupWindow).toBe(true)
})

it.each(['', '{', 'null', '[]', '{"updates":null}', '{"updates":[]}',
  '{"updates":{"allowTestAuthPopupWindow":"false"}}', '{"updates":{"allowTestAuthPopupWindow":1}}',
  '{"updates":{"allowTestAuthPopupWindow":null}}'])('reports invalid settings with their path and preserves the original: %s', async (raw) => {
  const { userData, path } = fixture()
  writeFileSync(path, raw)
  expect((await readDesktopSettings(userData)).updates.allowTestAuthPopupWindow).toBe(false)
  expect(console.warn).toHaveBeenCalledWith(expect.stringContaining(path), expect.any(Error))
  expect(readFileSync(path, 'utf8')).toBe(raw)
})

it('reports filesystem errors instead of replacing unreadable settings', async () => {
  const { userData, path } = fixture()
  mkdirSync(path)
  expect((await readDesktopSettings(userData)).updates.allowTestAuthPopupWindow).toBe(false)
  expect(console.warn).toHaveBeenCalledWith(expect.stringContaining(path), expect.any(Error))
  expect(fs.statSync(path).isDirectory()).toBe(true)
})

it.each(['mkdir', 'writeFile'] as const)('continues with disabled popups when %s fails', async (operation) => {
  const { userData, path } = fixture()
  const failure = Object.assign(new Error('settings creation denied'), { code: 'EACCES' })
  vi.spyOn(fsp, operation).mockRejectedValue(failure)
  expect((await readDesktopSettings(userData)).updates.allowTestAuthPopupWindow).toBe(false)
  expect(console.warn).toHaveBeenCalledWith(expect.stringContaining(path), expect.objectContaining({ cause: failure }))
})

it('continues with defaults even when warning output fails', async () => {
  const { userData, path } = fixture()
  writeFileSync(path, '{')
  vi.mocked(console.warn).mockImplementation(() => { throw new Error('output unavailable') })
  expect((await readDesktopSettings(userData)).updates.allowTestAuthPopupWindow).toBe(false)
  expect(readFileSync(path, 'utf8')).toBe('{')
})

it('reads an explicit web section and defaults an absent one without rewriting the document', async () => {
  const { userData, path } = fixture()
  const raw = JSON.stringify({ updates: { allowTestAuthPopupWindow: false }, web: { enabled: true, port: 4000, trustedHost: 'app.example' }, custom: 'preserve' })
  writeFileSync(path, raw)
  expect((await readDesktopSettings(userData)).web).toEqual({ enabled: true, port: 4000, trustedHost: 'app.example' })
  expect(readFileSync(path, 'utf8')).toBe(raw)
  // The domain is the one field with no default spelling: its absence resolves to none.
  for (const older of ['{}', '{"updates":{}}', '{"web":{}}', '{"web":{"enabled":true,"port":4000}}']) {
    writeFileSync(path, older)
    const expected = older === '{"web":{"enabled":true,"port":4000}}'
      ? { enabled: true, port: 4000, trustedHost: '' }
      : WEB_DEFAULTS
    expect((await readDesktopSettings(userData)).web).toEqual(expected)
    expect(readFileSync(path, 'utf8')).toBe(older)
  }
})

it.each([
  '{"web":null}', '{"web":[]}', '{"web":"on"}',
  '{"web":{"enabled":"true"}}', '{"web":{"enabled":1}}',
  '{"web":{"port":"3080"}}', '{"web":{"port":0}}', '{"web":{"port":-1}}', '{"web":{"port":65536}}',
  '{"web":{"port":3080.5}}',
  '{"web":{"trustedHost":null}}', '{"web":{"trustedHost":1}}', '{"web":{"trustedHost":[]}}',
  // A malformed domain is reported where the defaults apply, so a hand-edited typo cannot
  // abort the startup that would otherwise spend it.
  '{"web":{"trustedHost":"app example"}}',
  '{"web":{"trustedHost":"app.example:"}}', '{"web":{"trustedHost":"user@app.example"}}',
  '{"web":{"trustedHost":"-app.example"}}',
])('reports an invalid web section with its path and preserves the original: %s', async (raw) => {
  const { userData, path } = fixture()
  writeFileSync(path, raw)
  expect((await readDesktopSettings(userData)).web).toEqual(WEB_DEFAULTS)
  expect(console.warn).toHaveBeenCalledWith(expect.stringContaining(path), expect.any(Error))
  expect(readFileSync(path, 'utf8')).toBe(raw)
})

it('defaults the whole web section for one invalid member while keeping a valid popup preference', async () => {
  const { userData, path } = fixture()
  writeFileSync(path, '{"updates":{"allowTestAuthPopupWindow":true},"web":{"enabled":true,"port":0}}')
  expect(await readDesktopSettings(userData)).toEqual({ updates: { allowTestAuthPopupWindow: true }, web: WEB_DEFAULTS })
  expect(console.warn).toHaveBeenCalledTimes(1)
})

it('reads the stored web section without creating a missing document', async () => {
  const { userData, path } = fixture()
  rmSync(join(userData, 'desktop'), { recursive: true })
  expect(await readWebAccessSettings(userData)).toEqual(WEB_DEFAULTS)
  expect(fs.existsSync(path)).toBe(false)
  expect(console.warn).not.toHaveBeenCalled()
  mkdirSync(join(userData, 'desktop'))
  writeFileSync(path, '{"web":{"enabled":true,"port":0}}')
  expect(await readWebAccessSettings(userData)).toEqual(WEB_DEFAULTS)
  expect(console.warn).toHaveBeenCalledWith(expect.stringContaining(path), expect.any(Error))
  expect(readFileSync(path, 'utf8')).toBe('{"web":{"enabled":true,"port":0}}')
})

it('writes the web section without disturbing the rest of the document', async () => {
  const { userData, path } = fixture()
  writeFileSync(path, JSON.stringify({ updates: { allowTestAuthPopupWindow: true }, custom: 'preserve' }, null, 2))
  await writeWebAccessSettings(userData, { enabled: true, port: 4100, trustedHost: 'app.example' })
  expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({
    updates: { allowTestAuthPopupWindow: true }, custom: 'preserve',
    web: { enabled: true, port: 4100, trustedHost: 'app.example' },
  })
  expect(await readDesktopSettings(userData)).toEqual({
    updates: { allowTestAuthPopupWindow: true }, web: { enabled: true, port: 4100, trustedHost: 'app.example' },
  })
})

it('creates the web section on a home with no settings document yet', async () => {
  const { userData, path } = fixture()
  rmSync(join(userData, 'desktop'), { recursive: true })
  await writeWebAccessSettings(userData, { enabled: true, port: 4100, trustedHost: '' })
  expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ web: { enabled: true, port: 4100, trustedHost: '' } })
})

it.each([['[1, 2]', 'structure'], ['{"web":null}', 'structure'], ['{', 'json']])('refuses to overwrite a document it cannot reconstruct: %s', async (raw, reason) => {
  const { userData, path } = fixture()
  writeFileSync(path, raw)
  await expect(writeWebAccessSettings(userData, { enabled: true, port: 4100, trustedHost: '' })).rejects.toMatchObject({
    problem: { kind: 'invalid', reason },
  })
  expect(readFileSync(path, 'utf8')).toBe(raw)
})

// Storage has already classified the write; the Web access consumer must not retry it.
it.each(['written', 'unknown', 'unchanged'] as const)('accepts only a confirmed web section write and logs the %s outcome', async (effect) => {
  const { userData, path } = fixture()
  const failure = new DesktopSettingsFileError({ kind: 'write', operation: 'save', effect }, path,
    { cause: new Error('injected storage failure') })
  const save = vi.spyOn(DesktopSettingsFile.prototype, 'saveWebAccess').mockRejectedValueOnce(failure)
  const writing = writeWebAccessSettings(userData, { enabled: true, port: 4100, trustedHost: '' })
  if (effect === 'written') await expect(writing).resolves.toBeUndefined()
  else await expect(writing).rejects.toBe(failure)
  expect(save).toHaveBeenCalledTimes(1)
  expect(JSON.parse(readFileSync(`${path}.save.jsonl`, 'utf8'))).toMatchObject({
    event: 'settings-save-failed', effect, path, reason: 'injected storage failure',
  })
})
