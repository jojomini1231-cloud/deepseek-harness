// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GlobalStandardProps, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { DesktopWebAccessBridge, DesktopWebAccessChoice, DesktopWebAccessStatus } from '../src/types.ts'
import { DesktopWebAccessSource } from '../src/client/web-access-source.ts'
import { WebAccessRow } from '../src/client/WebAccessRow.tsx'
import { en, zh } from '../src/client/locales.ts'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

// Global standard kit stubs: the row consumes none of these hooks, but the
// runtime share requires every merged member to be present.
const useResource = (() => ({ status: 'none' as const, value: undefined, failure: undefined, reload: () => {} })) as GlobalStandardProps['useResource']
const usePanelInfo: GlobalStandardProps['usePanelInfo'] = selector => selector({ activePanelId: null })
const unusedHook = (() => { throw new Error('unused by the Web access row') }) as never
type AttentionSnapshot = Parameters<Parameters<GlobalStandardProps['useSessionStatus']>[0]>[0]
const noAttention: AttentionSnapshot = new Map()
const kit = {
  useSessions: unusedHook,
  useSessionStatus: ((select: (value: AttentionSnapshot) => unknown) => select(noAttention)) as GlobalStandardProps['useSessionStatus'],
  usePanelInfo,
  useSessionRetainInfo: () => undefined,
  useResource,
  useWorkspaces: unusedHook,
}

type SettingsTranslate = PropsLocale<'settings'>['t']

/** One translator bound to a dictionary, resolving the `{name}` placeholders the row passes. */
function translate(dictionary: typeof zh | typeof en): SettingsTranslate {
  const messages: Readonly<Record<string, string>> = dictionary
  return (key, params) => Object.entries(params ?? {})
    .reduce((message, [name, value]) => message.replaceAll(`{${name}}`, String(value)),
      messages[key] ?? key)
}

/** A carrier whose status the test resolves and pushes, and whose writers are spies. */
function fixture() {
  let listener: ((status: DesktopWebAccessStatus) => void) | undefined
  const initial = Promise.withResolvers<DesktopWebAccessStatus>()
  const update = vi.fn(async (next: DesktopWebAccessChoice) => ({ ...next, address: null, publicAddress: null, restartRequired: true }))
  const open = vi.fn(async () => {})
  const copyLink = vi.fn(async () => {})
  const unsubscribe = vi.fn()
  const bridge: DesktopWebAccessBridge = {
    status: () => initial.promise,
    update,
    open,
    copyLink,
    subscribe: (next) => { listener = next; return unsubscribe },
  }
  return { bridge, initial, update, open, copyLink, unsubscribe, push: (status: DesktopWebAccessStatus) => { listener?.(status) } }
}

/** Render the row over a real source store, exactly as the plugin's inject face does. */
function renderRow(source: DesktopWebAccessSource, dictionary: typeof zh | typeof en = zh) {
  const t = translate(dictionary)
  const subscribe = (notify: () => void) => source.store.subscribe(notify)
  const snapshot = () => source.store.getSnapshot()
  function Row() {
    const view = useSyncExternalStore(subscribe, snapshot)
    return <WebAccessRow
      {...kit}
      useWebAccess={select => select(view)}
      update={next => source.update(next)}
      open={() => source.open()}
      copyLink={() => source.copyLink()}
      portRange={{ min: 1, max: 65535 }}
      defaultPort={3080}
      t={t}
    />
  }
  return render(<Row />)
}

const OFF: DesktopWebAccessStatus = {
  enabled: false, port: 3080, trustedHost: '', address: null, publicAddress: null, restartRequired: false,
}

it('renders nothing before the carrier reports a status', () => {
  const { bridge } = fixture()
  const source = new DesktopWebAccessSource(bridge)
  const { container } = renderRow(source)
  expect(container.textContent).toBe('')
})

it('renders the switch, the port, the published domain, the live address, and both actions', async () => {
  const { bridge, initial, open, copyLink, push } = fixture()
  const source = new DesktopWebAccessSource(bridge)
  renderRow(source)
  const live: DesktopWebAccessStatus = {
    enabled: true, port: 3080, trustedHost: 'tunnel.example',
    address: '127.0.0.1:3080', publicAddress: 'https://tunnel.example/', restartRequired: false,
  }
  act(() => { initial.resolve(live) })
  await act(async () => { await initial.promise })
  act(() => { push(live) })
  expect(screen.getByText(zh['webAccess.title'])).toBeDefined()
  expect(screen.getByText(zh['webAccess.address'].replace('{address}', '127.0.0.1:3080'))).toBeDefined()
  expect(screen.getByText(zh['webAccess.publicAddress'].replace('{address}', 'https://tunnel.example/'))).toBeDefined()
  // The risk of publishing the listener is stated whether or not a domain is set.
  expect(screen.getByText(zh['webAccess.riskNotice'])).toBeDefined()
  fireEvent.click(screen.getByRole('button', { name: zh['webAccess.open'] }))
  expect(open).toHaveBeenCalledTimes(1)
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: zh['webAccess.copyLink'] })) })
  expect(copyLink).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('button', { name: zh['webAccess.copied'] })).toBeDefined()
})

it('shows no published address or copy action until a domain is configured', () => {
  const { bridge, push } = fixture()
  const source = new DesktopWebAccessSource(bridge)
  renderRow(source)
  act(() => { push({ ...OFF, enabled: true, address: '127.0.0.1:3080' }) })
  expect(screen.queryByRole('button', { name: zh['webAccess.copyLink'] })).toBeNull()
  expect(screen.queryByText(zh['webAccess.publicAddress'].replace('{address}', 'https://tunnel.example/'))).toBeNull()
  expect(screen.getByRole('button', { name: zh['webAccess.open'] })).toBeDefined()
})

it('writes the domain on its own without disturbing the port', async () => {
  const { bridge, update, push } = fixture()
  const source = new DesktopWebAccessSource(bridge)
  renderRow(source)
  act(() => { push({ ...OFF, port: 4123 }) })
  const domain = screen.getByLabelText(zh['webAccess.trustedHostLabel'])
  fireEvent.change(domain, { target: { value: 'https://tunnel.example/ui/' } })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: zh['webAccess.applyTrustedHost'] })) })
  expect(update).toHaveBeenCalledWith({ enabled: false, port: 4123, trustedHost: 'https://tunnel.example/ui/' })
})

it('refuses a domain the shell would refuse, before writing, while keeping the listener settings', () => {
  const { bridge, update, push } = fixture()
  const source = new DesktopWebAccessSource(bridge)
  renderRow(source)
  act(() => { push({ ...OFF, enabled: true, port: 4123, address: '127.0.0.1:4123' }) })
  const domain = screen.getByLabelText(zh['webAccess.trustedHostLabel'])
  for (const invalid of ['app.example/path', 'user@app.example', 'app.example:', '0x7f.0.0.1', 'app.example:08443', '-app.example']) {
    fireEvent.change(domain, { target: { value: invalid } })
    expect(screen.getByText(zh['webAccess.invalidTrustedHost']), invalid).toBeDefined()
    expect(screen.queryByRole('button', { name: zh['webAccess.applyTrustedHost'] }), invalid).toBeNull()
  }
  expect(update).not.toHaveBeenCalled()
  // Clearing the field is a valid draft again: it publishes nothing.
  fireEvent.change(domain, { target: { value: '' } })
  expect(screen.queryByText(zh['webAccess.invalidTrustedHost'])).toBeNull()
})

// The row re-implements the shell's authority rule so a draft fails without a round trip
// (`isTrustedHost` mirrors `parseWebAccessEndpoint` in `apps/desktop/src/web-access.ts`).
// The two copies cannot be linked by an import: this row is browser-bundled while the
// shell is Electron main. `apps/desktop/tests/web-access.spec.ts` asserts the same
// non-empty vectors, and each spec pins the empty value its own way: the row accepts it
// to clear a stored domain, the parser refuses it because it is only ever called with a
// value to publish. The port range next door is duplicated for the same reason.
const SHELL_ACCEPTS = [
  '', 'app.example', 'app.example:8443', 'http://tunnel.example:8080',
  'https://app.example/ui/', 'https://app.example/ui', 'App.Example', 'app.example:443',
  // WHATWG reads the backslash as a path separator, so this is the mount-prefix form.
  'https://app.example\\ui',
]
const SHELL_REFUSES = [
  ' ', 'app.example ', 'app.example/path', 'app.example\\ui',
  'user@app.example', 'app.example:', 'app.example:08443',
  '0x7f.0.0.1', '-app.example', 'https://', 'https://app.example?x=1', 'ftp://app.example',
]

it('accepts and refuses exactly the authorities the shell accepts and refuses', () => {
  const { bridge, push } = fixture()
  const source = new DesktopWebAccessSource(bridge)
  renderRow(source)
  act(() => { push({ ...OFF, enabled: true, address: '127.0.0.1:3080' }) })
  const domain = screen.getByLabelText(zh['webAccess.trustedHostLabel'])
  for (const accepted of SHELL_ACCEPTS) {
    fireEvent.change(domain, { target: { value: accepted } })
    expect(screen.queryByText(zh['webAccess.invalidTrustedHost']), JSON.stringify(accepted)).toBeNull()
  }
  for (const refused of SHELL_REFUSES) {
    fireEvent.change(domain, { target: { value: refused } })
    expect(screen.getByText(zh['webAccess.invalidTrustedHost']), JSON.stringify(refused)).toBeDefined()
  }
})

it('asks for a restart instead of an address while the running listener differs from the stored choice', async () => {
  const { bridge, push } = fixture()
  const source = new DesktopWebAccessSource(bridge)
  renderRow(source)
  act(() => { push({ enabled: true, port: 4000, trustedHost: 'tunnel.example', address: '127.0.0.1:3080', publicAddress: 'https://tunnel.example/', restartRequired: true }) })
  expect(screen.getByText(zh['webAccess.restartNotice'])).toBeDefined()
  expect(screen.queryByText(zh['webAccess.address'].replace('{address}', '127.0.0.1:3080'))).toBeNull()
  expect(screen.queryByRole('button', { name: zh['webAccess.open'] })).toBeNull()
  expect(screen.queryByRole('button', { name: zh['webAccess.copyLink'] })).toBeNull()
})

it('refuses an out-of-range draft before writing and reports a rejected write', async () => {
  const { bridge, update, push } = fixture()
  const source = new DesktopWebAccessSource(bridge)
  renderRow(source)
  act(() => { push(OFF) })
  const port = screen.getByLabelText(zh['webAccess.portLabel'])
  fireEvent.change(port, { target: { value: '70000' } })
  expect(screen.getByText(zh['webAccess.invalidPort'].replace('{min}', '1').replace('{max}', '65535'))).toBeDefined()
  expect(screen.queryByRole('button', { name: zh['webAccess.applyPort'] })).toBeNull()
  expect(update).not.toHaveBeenCalled()
  fireEvent.change(port, { target: { value: '4000' } })
  update.mockRejectedValueOnce(new Error('refused'))
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: zh['webAccess.applyPort'] })) })
  expect(update).toHaveBeenCalledWith({ enabled: false, port: 4000, trustedHost: '' })
  expect(screen.getByRole('alert').textContent).toBe(zh['webAccess.error'])
})

it('writes the flag on its own without disturbing the port or the domain', async () => {
  const { bridge, update, push } = fixture()
  const source = new DesktopWebAccessSource(bridge)
  renderRow(source)
  act(() => { push({ ...OFF, port: 4123, trustedHost: 'tunnel.example' }) })
  await act(async () => { fireEvent.click(screen.getByRole('switch')) })
  expect(update).toHaveBeenCalledWith({ enabled: true, port: 4123, trustedHost: 'tunnel.example' })
})

it('keeps a typed but unapplied draft when the switch is flipped', async () => {
  const { bridge, update, push } = fixture()
  const source = new DesktopWebAccessSource(bridge)
  renderRow(source)
  act(() => { push({ ...OFF, port: 4123 }) })
  // The switch is the only control that writes both fields, so flipping it must not
  // discard work the user has typed and has not applied yet.
  fireEvent.change(screen.getByLabelText(zh['webAccess.portLabel']), { target: { value: '5000' } })
  fireEvent.change(screen.getByLabelText(zh['webAccess.trustedHostLabel']), { target: { value: 'tunnel.example' } })
  await act(async () => { fireEvent.click(screen.getByRole('switch')) })
  expect(update).toHaveBeenCalledWith({ enabled: true, port: 5000, trustedHost: 'tunnel.example' })
})

it('drops a draft the shell would refuse rather than sending it with the switch', async () => {
  const { bridge, update, push } = fixture()
  const source = new DesktopWebAccessSource(bridge)
  renderRow(source)
  act(() => { push({ ...OFF, port: 4123, trustedHost: 'tunnel.example' }) })
  fireEvent.change(screen.getByLabelText(zh['webAccess.portLabel']), { target: { value: '70000' } })
  fireEvent.change(screen.getByLabelText(zh['webAccess.trustedHostLabel']), { target: { value: 'bad host' } })
  await act(async () => { fireEvent.click(screen.getByRole('switch')) })
  expect(update).toHaveBeenCalledWith({ enabled: true, port: 4123, trustedHost: 'tunnel.example' })
})

it('reports a failed copy without claiming the link was taken or that a write failed', async () => {
  const { bridge, copyLink, push } = fixture()
  const source = new DesktopWebAccessSource(bridge)
  renderRow(source)
  act(() => { push({ ...OFF, enabled: true, address: '127.0.0.1:3080', trustedHost: 'tunnel.example', publicAddress: 'https://tunnel.example/' }) })
  copyLink.mockRejectedValueOnce(new Error('clipboard unavailable'))
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: zh['webAccess.copyLink'] })) })
  // Nothing was saved by a copy, so the save-failure wording never appears here.
  expect(screen.getByRole('alert').textContent).toBe(zh['webAccess.copyError'])
  expect(screen.queryByText(zh['webAccess.error'])).toBeNull()
  expect(screen.getByRole('button', { name: zh['webAccess.copyLink'] })).toBeDefined()
})

it('states the consequence only while the listener is on, and shows the same row in English', () => {
  const { bridge, push } = fixture()
  const source = new DesktopWebAccessSource(bridge)
  renderRow(source, en)
  act(() => { push(OFF) })
  expect(screen.getByText(en['webAccess.title'])).toBeDefined()
  expect(screen.getByText(en['webAccess.description'])).toBeDefined()
  // An inert row exposes nothing, so it carries no standing warning.
  expect(screen.queryByText(en['webAccess.riskNotice'])).toBeNull()
  act(() => { push({ ...OFF, enabled: true, address: '127.0.0.1:3080' }) })
  expect(screen.getByText(en['webAccess.riskNotice'])).toBeDefined()
})

describe('carrier source', () => {
  it('adopts the pushed status over the initial read and stops after disposal', async () => {
    const { bridge, update, push } = fixture()
    const source = new DesktopWebAccessSource(bridge)
    expect(source.available).toBe(true)
    await act(async () => { await Promise.resolve() })
    const next: DesktopWebAccessStatus = {
      enabled: true, port: 4000, trustedHost: '', address: '127.0.0.1:4000', publicAddress: null, restartRequired: false,
    }
    act(() => { push(next) })
    expect(source.store.getSnapshot().status).toEqual(next)
    await act(async () => { await source.update({ enabled: true, port: 4001, trustedHost: '' }) })
    expect(source.store.getSnapshot().status).toMatchObject({ port: 4001, restartRequired: true })
    expect(update).toHaveBeenCalledWith({ enabled: true, port: 4001, trustedHost: '' })
    source.dispose()
    act(() => { push({ ...next, port: 9999 }) })
    expect(source.store.getSnapshot().status).toMatchObject({ port: 4001 })
  })

  it('reports a failed first read and never claims availability without a bridge', async () => {
    const failing: DesktopWebAccessBridge = {
      status: async () => { throw new Error('unavailable') },
      update: async next => ({ ...next, address: null, publicAddress: null, restartRequired: false }),
      open: async () => {},
      copyLink: async () => {},
      subscribe: () => () => {},
    }
    const broken = new DesktopWebAccessSource(failing)
    await act(async () => { await Promise.resolve() })
    expect(broken.store.getSnapshot()).toEqual({ failed: true })
    const absent = new DesktopWebAccessSource(undefined)
    expect(absent.available).toBe(false)
    await expect(absent.update({ enabled: true, port: 3080, trustedHost: '' })).rejects.toThrow('unavailable')
    await expect(absent.open()).rejects.toThrow('unavailable')
    await expect(absent.copyLink()).rejects.toThrow('unavailable')
  })
})
