// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GlobalStandardProps, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { DesktopWebAccessBridge, DesktopWebAccessStatus } from '../src/types.ts'
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
  const update = vi.fn(async (next: { enabled: boolean; port: number }) => ({ ...next, address: null, restartRequired: true }))
  const open = vi.fn(async () => {})
  const unsubscribe = vi.fn()
  const bridge: DesktopWebAccessBridge = {
    status: () => initial.promise,
    update,
    open,
    subscribe: (next) => { listener = next; return unsubscribe },
  }
  return { bridge, initial, update, open, unsubscribe, push: (status: DesktopWebAccessStatus) => { listener?.(status) } }
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
      portRange={{ min: 1, max: 65535 }}
      defaultPort={3080}
      t={t}
    />
  }
  return render(<Row />)
}

const OFF: DesktopWebAccessStatus = { enabled: false, port: 3080, address: null, restartRequired: false }

it('renders nothing before the carrier reports a status', () => {
  const { bridge } = fixture()
  const source = new DesktopWebAccessSource(bridge)
  const { container } = renderRow(source)
  expect(container.textContent).toBe('')
})

it('renders the switch, the port, and the live address, and offers the browser action', () => {
  const { bridge, initial, open, push } = fixture()
  const source = new DesktopWebAccessSource(bridge)
  renderRow(source)
  act(() => { initial.resolve({ enabled: true, port: 3080, address: '127.0.0.1:3080', restartRequired: false }) })
  return initial.promise.then(() => {
    act(() => { push({ enabled: true, port: 3080, address: '127.0.0.1:3080', restartRequired: false }) })
    expect(screen.getByText(zh['webAccess.title'])).toBeDefined()
    expect(screen.getByText(zh['webAccess.address'].replace('{address}', '127.0.0.1:3080'))).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: zh['webAccess.open'] }))
    expect(open).toHaveBeenCalledTimes(1)
  })
})

it('asks for a restart instead of an address while the running listener differs from the stored choice', async () => {
  const { bridge, push } = fixture()
  const source = new DesktopWebAccessSource(bridge)
  renderRow(source)
  act(() => { push({ enabled: true, port: 4000, address: '127.0.0.1:3080', restartRequired: true }) })
  expect(screen.getByText(zh['webAccess.restartNotice'])).toBeDefined()
  expect(screen.queryByText(zh['webAccess.address'].replace('{address}', '127.0.0.1:3080'))).toBeNull()
  expect(screen.queryByRole('button', { name: zh['webAccess.open'] })).toBeNull()
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
  expect(update).toHaveBeenCalledWith({ enabled: false, port: 4000 })
  expect(screen.getByRole('alert').textContent).toBe(zh['webAccess.error'])
})

it('writes the flag on its own without disturbing the port', async () => {
  const { bridge, update, push } = fixture()
  const source = new DesktopWebAccessSource(bridge)
  renderRow(source)
  act(() => { push({ enabled: false, port: 4123, address: null, restartRequired: false }) })
  await act(async () => { fireEvent.click(screen.getByRole('switch')) })
  expect(update).toHaveBeenCalledWith({ enabled: true, port: 4123 })
})

it('shows the same row in English', () => {
  const { bridge, push } = fixture()
  const source = new DesktopWebAccessSource(bridge)
  renderRow(source, en)
  act(() => { push(OFF) })
  expect(screen.getByText(en['webAccess.title'])).toBeDefined()
  expect(screen.getByText(en['webAccess.description'])).toBeDefined()
})

describe('carrier source', () => {
  it('adopts the pushed status over the initial read and stops after disposal', async () => {
    const { bridge, update, push } = fixture()
    const source = new DesktopWebAccessSource(bridge)
    expect(source.available).toBe(true)
    await act(async () => { await Promise.resolve() })
    const next: DesktopWebAccessStatus = { enabled: true, port: 4000, address: '127.0.0.1:4000', restartRequired: false }
    act(() => { push(next) })
    expect(source.store.getSnapshot().status).toEqual(next)
    await act(async () => { await source.update({ enabled: true, port: 4001 }) })
    expect(source.store.getSnapshot().status).toMatchObject({ port: 4001, restartRequired: true })
    expect(update).toHaveBeenCalledWith({ enabled: true, port: 4001 })
    source.dispose()
    act(() => { push({ ...next, port: 9999 }) })
    expect(source.store.getSnapshot().status).toMatchObject({ port: 4001 })
  })

  it('reports a failed first read and never claims availability without a bridge', async () => {
    const failing: DesktopWebAccessBridge = {
      status: async () => { throw new Error('unavailable') },
      update: async next => ({ ...next, address: null, restartRequired: false }),
      open: async () => {},
      subscribe: () => () => {},
    }
    const broken = new DesktopWebAccessSource(failing)
    await act(async () => { await Promise.resolve() })
    expect(broken.store.getSnapshot()).toEqual({ failed: true })
    const absent = new DesktopWebAccessSource(undefined)
    expect(absent.available).toBe(false)
    await expect(absent.update({ enabled: true, port: 3080 })).rejects.toThrow('unavailable')
    await expect(absent.open()).rejects.toThrow('unavailable')
  })
})
