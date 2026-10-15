// @vitest-environment jsdom
/** The device page: its loading, empty, error, rename, and revoke postures. */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RemoteError } from '@deepseek-ai/dsh-client-test-runtime'
import type { BrowserDeviceView } from '@deepseek-ai/dsh-api-remotes/client'
import type { GlobalStandardProps, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { DevicesSection } from '../src/client/DevicesSection.tsx'
import { createDeviceRoster } from '../src/client/device-store.ts'
import type { DeviceRosterDeps } from '../src/client/device-store.ts'
import { zh } from '../src/client/locales.ts'

afterEach(() => { cleanup() })

// Global standard kit stubs: the page consumes none of these hooks, but the
// runtime share requires every merged member to be present.
const unusedHook = (() => { throw new Error('unused by the device page') }) as never
const kit: GlobalStandardProps = {
  useSessions: unusedHook,
  useSessionStatus: unusedHook,
  usePanelInfo: unusedHook,
  useSessionRetainInfo: () => undefined,
  useResource: unusedHook,
  useWorkspaces: unusedHook,
}

type Translate = PropsLocale<'settings.devices'>['t']

/** One translator resolving the `{n}` placeholders the page passes. */
function translate(): Translate {
  const messages: Readonly<Record<string, string>> = zh
  return (key, params) => Object.entries(params ?? {})
    .reduce((message, [name, value]) => message.replaceAll(`{${name}}`, String(value)), messages[key] ?? key)
}

function device(id: string, overrides: Partial<BrowserDeviceView> = {}): BrowserDeviceView {
  return { id, userAgent: 'Agent/1', firstSeenAt: 1, lastSeenAt: 1, ...overrides }
}

const CHROME_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'

/** Render the page over a roster built from the given Remote answers. */
function renderPage(overrides: Partial<DeviceRosterDeps> = {}) {
  const deps: DeviceRosterDeps = {
    list: vi.fn(() => Promise.resolve({ ok: true as const, value: [device('a', { userAgent: CHROME_MAC })] })),
    rename: vi.fn(() => Promise.resolve({ ok: true as const, value: device('a') })),
    revoke: vi.fn(() => Promise.resolve({ ok: true as const, value: undefined })),
    ...overrides,
  }
  const roster = createDeviceRoster(deps)
  const props = {
    ...kit,
    close: () => {},
    t: translate(),
    useDevices: ((select: (snapshot: unknown) => unknown) =>
      useSyncExternalStore(fn => roster.hooks.devices.subscribe(fn), () => select(roster.hooks.devices.getSnapshot()))) as never,
    refresh: roster.refresh,
    rename: roster.rename,
    revoke: roster.revoke,
  }
  return { ...render(<DevicesSection {...props} />), roster, deps }
}

/** Render the page and let its mount-time read settle. */
async function renderSettled(overrides: Partial<DeviceRosterDeps> = {}) {
  const page = renderPage(overrides)
  await act(async () => { await Promise.resolve() })
  return page
}

/** Wait for a write and the re-read that follows it. */
async function settle(): Promise<void> {
  await act(async () => { await Promise.resolve() })
}

describe('DevicesSection', () => {
  it('names a device from its user agent until the operator renames it', async () => {
    await renderSettled()
    expect(screen.getByText('Chrome · macOS')).toBeTruthy()
    // The raw agent stays visible so an unnamed browser is still identifiable.
    expect(screen.getByText(CHROME_MAC)).toBeTruthy()
    expect(screen.getByText(zh.title)).toBeTruthy()
  })

  it('prefers the label the operator set', async () => {
    await renderSettled({
      list: () => Promise.resolve({ ok: true as const, value: [device('a', { userAgent: CHROME_MAC, name: '厨房笔记本' })] }),
    })
    expect(screen.getByText('厨房笔记本')).toBeTruthy()
    expect(screen.queryByText('Chrome · macOS')).toBeNull()
  })

  it('shows the empty state once a read succeeds with nothing recorded', async () => {
    await renderSettled({ list: () => Promise.resolve({ ok: true as const, value: [] }) })
    expect(screen.getByText(zh.empty)).toBeTruthy()
  })

  it('offers a retry when the read failed', async () => {
    const list = vi.fn<DeviceRosterDeps['list']>()
      .mockImplementationOnce(() => Promise.reject(new Error('down')))
      .mockImplementationOnce(() => Promise.resolve({ ok: true as const, value: [device('a', { userAgent: CHROME_MAC })] }))
    await renderSettled({ list })
    expect(screen.getByText(zh.loadFailed)).toBeTruthy()
    await act(async () => { fireEvent.click(screen.getByText(zh.retry)) })
    await settle()
    expect(screen.getByText('Chrome · macOS')).toBeTruthy()
  })

  it('saves a rename through the roster and re-reads', async () => {
    const rename = vi.fn<DeviceRosterDeps['rename']>(() => Promise.resolve({ ok: true as const, value: device('a') }))
    await renderSettled({ rename })
    fireEvent.click(screen.getByText(zh.rename))
    fireEvent.change(screen.getByLabelText(zh.renameLabel), { target: { value: '厨房笔记本' } })
    await act(async () => { fireEvent.click(screen.getByText(zh.save)) })
    expect(rename).toHaveBeenCalledWith('a', '厨房笔记本')
  })

  it('reports a refused rename on the page instead of failing silently', async () => {
    await renderSettled({
      rename: () => Promise.resolve({ ok: false as const, error: new RemoteError('devices/rejected', 'no', { id: 'a' }) }),
    })
    fireEvent.click(screen.getByText(zh.rename))
    await act(async () => { fireEvent.click(screen.getByText(zh.save)) })
    expect(screen.getByText(zh.renameFailed)).toBeTruthy()
  })

  it('confirms before revoking, and names the consequence for the current browser', async () => {
    const revoke = vi.fn<DeviceRosterDeps['revoke']>(() => Promise.resolve({ ok: true as const, value: undefined }))
    await renderSettled({ revoke })
    fireEvent.click(screen.getByText(zh.revoke))
    // Nothing is revoked until the confirmation is accepted.
    expect(revoke).not.toHaveBeenCalled()
    expect(screen.getByText(zh.revokeMessage)).toBeTruthy()
    await act(async () => { fireEvent.click(screen.getByText(zh.revokeConfirm)) })
    expect(revoke).toHaveBeenCalledWith('a')
  })

  it('reports a refused revoke on the page', async () => {
    await renderSettled({
      revoke: () => Promise.resolve({ ok: false as const, error: new RemoteError('devices/unknown', 'no', { id: 'a' }) }),
    })
    fireEvent.click(screen.getByText(zh.revoke))
    await act(async () => { fireEvent.click(screen.getByText(zh.revokeConfirm)) })
    expect(screen.getByText(zh.revokeFailed)).toBeTruthy()
  })

  it('discards a rename the operator cancels', async () => {
    const rename = vi.fn<DeviceRosterDeps['rename']>(() => Promise.resolve({ ok: true as const, value: device('a') }))
    await renderSettled({ rename })
    fireEvent.click(screen.getByText(zh.rename))
    await act(async () => { fireEvent.click(screen.getByText(zh.cancel)) })
    expect(rename).not.toHaveBeenCalled()
    expect(screen.queryByLabelText(zh.renameLabel)).toBeNull()
  })

  it('cancels a revoke without touching the deployment', async () => {
    const revoke = vi.fn<DeviceRosterDeps['revoke']>(() => Promise.resolve({ ok: true as const, value: undefined }))
    await renderSettled({ revoke })
    fireEvent.click(screen.getByText(zh.revoke))
    await act(async () => { fireEvent.click(screen.getByText(zh.cancel)) })
    expect(revoke).not.toHaveBeenCalled()
    expect(screen.queryByText(zh.revokeMessage)).toBeNull()
  })

  it('dates a device in the interface language', async () => {
    const now = Date.now()
    await renderSettled({
      list: () => Promise.resolve({
        ok: true as const,
        value: [device('a', { userAgent: CHROME_MAC, firstSeenAt: now, lastSeenAt: now })],
      }),
    })
    expect(screen.getAllByText(zh['time.now']).length).toBeGreaterThan(0)
  })

  it('re-samples the clock while the page stays open', async () => {
    vi.useFakeTimers()
    try {
      const at = Date.now()
      const page = renderPage({
        list: () => Promise.resolve({
          ok: true as const,
          value: [device('a', { userAgent: CHROME_MAC, firstSeenAt: at, lastSeenAt: at })],
        }),
      })
      await act(async () => { await Promise.resolve() })
      expect(screen.getAllByText(zh['time.now']).length).toBeGreaterThan(0)
      // Half a minute on, the same device is dated by the bucket it crossed.
      await act(async () => { vi.advanceTimersByTime(60_000) })
      expect(screen.getAllByText(zh['time.minutes'].replace('{n}', '1')).length).toBeGreaterThan(0)
      // Unmounting stops the clock rather than leaving a timer behind.
      act(() => { page.unmount() })
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('announces the first read with a skeleton instead of an empty roster', async () => {
    const pending = Promise.withResolvers<{ ok: true; value: BrowserDeviceView[] }>()
    const page = renderPage({ list: () => pending.promise })
    expect(screen.getByText(zh.loading)).toBeTruthy()
    expect(page.container.querySelector('[aria-busy="true"]')).toBeTruthy()
    // A skeleton row is a placeholder, not a row a screen reader should read.
    expect(page.container.querySelectorAll('[aria-hidden="true"] li').length).toBeGreaterThan(0)
    await act(async () => {
      pending.resolve({ ok: true, value: [device('a', { userAgent: CHROME_MAC })] })
      await Promise.resolve()
    })
    expect(screen.queryByText(zh.loading)).toBeNull()
    expect(page.container.querySelector('[aria-busy="false"]')).toBeTruthy()
  })

  it('names the device each row control acts on', async () => {
    await renderSettled({
      list: () => Promise.resolve({
        ok: true as const,
        value: [device('a', { userAgent: CHROME_MAC, name: '厨房笔记本' })],
      }),
    })
    expect(screen.getByLabelText(zh.renameDevice.replace('{name}', '厨房笔记本'))).toBeTruthy()
    expect(screen.getByLabelText(zh.revokeDevice.replace('{name}', '厨房笔记本'))).toBeTruthy()
  })

  it('shows the peer address the deployment observed', async () => {
    await renderSettled({
      list: () => Promise.resolve({
        ok: true as const,
        value: [device('a', { userAgent: CHROME_MAC, address: '10.0.0.7' })],
      }),
    })
    expect(screen.getByText(zh.address)).toBeTruthy()
    expect(screen.getByText('10.0.0.7')).toBeTruthy()
  })

  it('announces a read failure as an alert and a refused write politely', async () => {
    await renderSettled({
      list: () => Promise.resolve({ ok: false as const, error: new RemoteError('gateway/internal', 'no', {}) }),
    })
    expect(screen.getByRole('alert').textContent).toContain(zh.loadFailed)

    cleanup()
    await renderSettled({
      rename: () => Promise.resolve({ ok: false as const, error: new RemoteError('devices/rejected', 'no', { id: 'a' }) }),
    })
    fireEvent.click(screen.getByText(zh.rename))
    await act(async () => { fireEvent.click(screen.getByText(zh.save)) })
    expect(screen.getByRole('status').textContent).toBe(zh.renameFailed)
  })

  it('clears a refusal once the operator\'s next write is accepted', async () => {
    const rename = vi.fn<DeviceRosterDeps['rename']>()
      .mockImplementationOnce(() => Promise.resolve({
        ok: false as const, error: new RemoteError('devices/rejected', 'no', { id: 'a' }),
      }))
      .mockImplementationOnce(() => Promise.resolve({ ok: true as const, value: device('a') }))
    await renderSettled({ rename })
    fireEvent.click(screen.getByText(zh.rename))
    await act(async () => { fireEvent.click(screen.getByText(zh.save)) })
    expect(screen.getByText(zh.renameFailed)).toBeTruthy()
    // The accepted write replaces the stale refusal instead of leaving it up.
    fireEvent.click(screen.getByText(zh.rename))
    await act(async () => { fireEvent.click(screen.getByText(zh.save)) })
    expect(screen.queryByText(zh.renameFailed)).toBeNull()
  })

  it('names a self-revoke and withholds a retry that cannot succeed', async () => {
    const list = vi.fn<DeviceRosterDeps['list']>()
      .mockImplementationOnce(() => Promise.resolve({ ok: true as const, value: [device('a', { userAgent: CHROME_MAC })] }))
      .mockImplementationOnce(() => Promise.reject(new Error('unauthorized')))
    await renderSettled({ list })
    fireEvent.click(screen.getByText(zh.revoke))
    await act(async () => { fireEvent.click(screen.getByText(zh.revokeConfirm)) })
    expect(screen.getByRole('alert').textContent).toContain(zh.signedOut)
    expect(screen.queryByText(zh.retry)).toBeNull()
  })
})
