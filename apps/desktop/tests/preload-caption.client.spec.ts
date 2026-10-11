// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { DESKTOP_IPC } from '../src/ipc.ts'
import { syncDesktopCaption } from '../src/preload-caption.ts'

const send = vi.hoisted(() => vi.fn())
const installCaptionControls = vi.hoisted(() => vi.fn(() => ({ update: vi.fn(), dispose: vi.fn() })))
vi.mock('electron', () => ({ ipcRenderer: { send } }))
vi.mock('../src/preload-menu.ts', () => ({ installWindowsMenu: () => ({ update: vi.fn(), dispose: vi.fn() }) }))
vi.mock('../src/preload-caption-controls.ts', () => ({ installCaptionControls }))

afterEach(() => {
  window.dispatchEvent(new Event('pagehide'))
  document.documentElement.removeAttribute('data-desktop-caption')
  document.documentElement.style.removeProperty('--dsh-desktop-caption-height')
  document.documentElement.lang = 'en'
  document.body.removeAttribute('data-ds-dark-theme')
  document.body.replaceChildren()
  vi.restoreAllMocks()
  send.mockClear()
  installCaptionControls.mockClear()
})

it('installs no caption on macOS, whose traffic lights sit in the sidebar', () => {
  vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
  syncDesktopCaption()
  expect(document.documentElement.hasAttribute('data-desktop-caption')).toBe(false)
  expect(send).not.toHaveBeenCalled()
  expect(installCaptionControls).not.toHaveBeenCalled()
})

it('marks the caption band and installs drawn controls on Linux without the Windows menu', () => {
  vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
  syncDesktopCaption()
  expect(document.documentElement.hasAttribute('data-desktop-caption')).toBe(true)
  expect(document.documentElement.style.getPropertyValue('--dsh-desktop-caption-height')).toBe('40px')
  expect(installCaptionControls).toHaveBeenCalledOnce()
  // The shell's palette probe feeds the Windows titleBarOverlay only.
  expect(send).not.toHaveBeenCalled()
})

it('synchronizes live language and palette changes and stops observing a closed document', async () => {
  vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
  vi.spyOn(document, 'readyState', 'get').mockReturnValue('loading')
  vi.spyOn(globalThis, 'getComputedStyle').mockImplementation(() => ({
    backgroundColor: document.body.hasAttribute('data-ds-dark-theme') ? 'oklch(0.2 0 0)' : 'hsl(0 0% 100%)',
    color: 'black',
  }) as CSSStyleDeclaration)
  const context = {
    fillStyle: '', clearRect: vi.fn(), fillRect: vi.fn(),
    getImageData: () => ({ data: new Uint8ClampedArray(context.fillStyle === 'black'
      ? [0, 0, 0, 255] : context.fillStyle.startsWith('oklch') ? [27, 27, 28, 255] : [255, 255, 255, 255]) }),
  }
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D)
  document.documentElement.lang = 'en'
  syncDesktopCaption()
  expect(send).not.toHaveBeenCalled()
  expect(document.documentElement.hasAttribute('data-desktop-caption')).toBe(true)
  expect(installCaptionControls).not.toHaveBeenCalled()
  window.dispatchEvent(new Event('DOMContentLoaded'))
  expect(document.documentElement.style.getPropertyValue('--dsh-desktop-caption-height')).toBe('40px')
  expect(send).toHaveBeenLastCalledWith(DESKTOP_IPC.windowsAppearance, 'en', 'rgba(255, 255, 255, 1)', 'rgba(0, 0, 0, 1)')
  document.documentElement.lang = 'zh-CN'
  document.body.setAttribute('data-ds-dark-theme', '')
  await vi.waitFor(() => { expect(send).toHaveBeenLastCalledWith(DESKTOP_IPC.windowsAppearance, 'zh-CN', 'rgba(27, 27, 28, 1)', 'rgba(0, 0, 0, 1)') })
  window.dispatchEvent(new Event('pagehide'))
  send.mockClear()
  document.documentElement.lang = 'en'
  await new Promise<void>((resolve) => { queueMicrotask(resolve) })
  expect(send).not.toHaveBeenCalled()
})
