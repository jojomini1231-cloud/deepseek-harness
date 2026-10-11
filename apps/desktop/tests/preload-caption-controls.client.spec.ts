// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { DESKTOP_IPC } from '../src/ipc.ts'
import { installCaptionControls } from '../src/preload-caption-controls.ts'

const invoke = vi.hoisted(() => vi.fn<(...args: unknown[]) => Promise<void>>())
const listeners = vi.hoisted(() => new Map<string, (event: unknown, value: boolean) => void>())
vi.mock('electron', () => ({
  ipcRenderer: {
    invoke,
    on: (channel: string, listener: (event: unknown, value: boolean) => void) => { listeners.set(channel, listener) },
    off: (channel: string) => { listeners.delete(channel) },
  },
}))
let controls: ReturnType<typeof installCaptionControls> | undefined

beforeEach(() => {
  const appSeat = document.createElement('div')
  appSeat.dataset.shellOverlay = ''
  document.body.append(appSeat)
  document.documentElement.lang = 'en'
  invoke.mockResolvedValue(undefined)
})

afterEach(() => {
  controls?.dispose()
  controls = undefined
  document.body.replaceChildren()
  document.documentElement.lang = ''
  listeners.clear()
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

/** The mounted caption control host. */
const host = (): HTMLElement => {
  const element = document.querySelector<HTMLElement>('[data-caption-controls]')
  if (element === null) throw new Error('caption controls not mounted')
  return element
}
/** One control button inside the mounted host. */
const button = (control: string): HTMLButtonElement => {
  const element = host().shadowRoot!.querySelector<HTMLButtonElement>(`button[data-control='${control}']`)
  if (element === null) throw new Error(`caption control missing: ${control}`)
  return element
}

it('mounts only after the application frame replaces the loading document', async () => {
  document.body.replaceChildren()
  controls = installCaptionControls()
  const loading = document.createElement('div')
  loading.dataset.dshBoot = ''
  document.body.append(loading)
  await new Promise<void>((resolve) => { queueMicrotask(resolve) })
  expect(document.querySelector('[data-caption-controls]')).toBeNull()
  const appSeat = document.createElement('div')
  appSeat.dataset.shellOverlay = ''
  loading.replaceWith(appSeat)
  await vi.waitFor(() => { expect(document.querySelector('[data-caption-controls]')).not.toBeNull() })
})

it('does not mount after the document is disposed', async () => {
  document.body.replaceChildren()
  controls = installCaptionControls()
  controls.dispose()
  const appSeat = document.createElement('div')
  appSeat.dataset.shellOverlay = ''
  document.body.append(appSeat)
  await new Promise<void>((resolve) => { queueMicrotask(resolve) })
  expect(document.querySelector('[data-caption-controls]')).toBeNull()
})

it('requests the matching window command from each control', () => {
  controls = installCaptionControls()
  button('minimize').click()
  expect(invoke).toHaveBeenLastCalledWith(DESKTOP_IPC.windowControl, 'minimize')
  button('maximize').click()
  expect(invoke).toHaveBeenLastCalledWith(DESKTOP_IPC.windowControl, 'maximize-toggle')
  button('close').click()
  expect(invoke).toHaveBeenLastCalledWith(DESKTOP_IPC.windowControl, 'close')
})

it('keeps focus behind the caption by cancelling pointer and mouse defaults', () => {
  controls = installCaptionControls()
  for (const control of ['minimize', 'maximize', 'close']) {
    const target = button(control)
    const pointer = new Event('pointerdown', { cancelable: true })
    target.dispatchEvent(pointer)
    expect(pointer.defaultPrevented).toBe(true)
    const mouse = new Event('mousedown', { cancelable: true })
    target.dispatchEvent(mouse)
    expect(mouse.defaultPrevented).toBe(true)
  }
})

it('labels every control from the active locale', () => {
  controls = installCaptionControls()
  const group = host().shadowRoot!.querySelector('[role=group]')!
  expect(group.getAttribute('aria-label')).toBe('Window controls')
  expect(button('minimize').getAttribute('aria-label')).toBe('Minimize')
  expect(button('minimize').title).toBe('Minimize')
  expect(button('maximize').getAttribute('aria-label')).toBe('Maximize')
  expect(button('close').getAttribute('aria-label')).toBe('Close window')
  expect(button('close').title).toBe('Close window')
  document.documentElement.lang = 'zh-CN'
  controls.update()
  expect(group.getAttribute('aria-label')).toBe('窗口控件')
  expect(button('minimize').getAttribute('aria-label')).toBe('最小化')
  expect(button('close').getAttribute('aria-label')).toBe('关闭窗口')
})

it('follows the language the document switches to', async () => {
  controls = installCaptionControls()
  document.documentElement.lang = 'zh-CN'
  await vi.waitFor(() => { expect(button('minimize').getAttribute('aria-label')).toBe('最小化') })
})

it('swaps the maximize control to restore when the shell reports a maximized window', async () => {
  controls = installCaptionControls()
  const windowed = button('maximize').querySelector('path')!.getAttribute('d')
  expect(host().hasAttribute('data-maximized')).toBe(false)
  listeners.get(DESKTOP_IPC.windowMaximized)!({}, true)
  await vi.waitFor(() => { expect(host().hasAttribute('data-maximized')).toBe(true) })
  expect(button('maximize').getAttribute('aria-label')).toBe('Restore')
  expect(button('maximize').querySelector('path')!.getAttribute('d')).not.toBe(windowed)
  listeners.get(DESKTOP_IPC.windowMaximized)!({}, false)
  expect(host().hasAttribute('data-maximized')).toBe(false)
  expect(button('maximize').getAttribute('aria-label')).toBe('Maximize')
  expect(button('maximize').querySelector('path')!.getAttribute('d')).toBe(windowed)
})

it('keeps a restore label when the language changes while maximized', () => {
  controls = installCaptionControls()
  listeners.get(DESKTOP_IPC.windowMaximized)!({}, true)
  document.documentElement.lang = 'zh-CN'
  controls.update()
  expect(button('maximize').getAttribute('aria-label')).toBe('还原')
})

it('stops listening and leaves the document after disposal', () => {
  controls = installCaptionControls()
  controls.dispose()
  controls = undefined
  expect(document.querySelector('[data-caption-controls]')).toBeNull()
  expect(listeners.has(DESKTOP_IPC.windowMaximized)).toBe(false)
})

it('reports a rejected window command without disturbing the control', async () => {
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
  controls = installCaptionControls()
  invoke.mockRejectedValueOnce(new Error('rejected'))
  button('minimize').click()
  await vi.waitFor(() => { expect(consoleError).toHaveBeenCalled() })
  expect(button('minimize').isConnected).toBe(true)
})
