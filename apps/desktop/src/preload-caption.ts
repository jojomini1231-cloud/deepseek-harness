/** Synchronizes the Desktop caption marker, the Windows caption menus, and the Linux caption controls. */
import { ipcRenderer } from 'electron'
import { DESKTOP_CAPTION_HEIGHT } from './desktop-layout.ts'
import { DESKTOP_IPC } from './ipc.ts'
import { installCaptionControls } from './preload-caption-controls.ts'
import { installWindowsMenu } from './preload-menu.ts'

/**
 * Install the caption marker on the platforms whose window carries a caption
 * band, then start that platform's caption observers.
 *
 * Windows keeps native window controls over the band, so it observes the
 * application language and palette and reports them to the shell. Linux draws
 * its own controls. macOS draws neither: its traffic lights sit in the sidebar
 * and the frame publishes no caption band.
 */
export function syncDesktopCaption(): void {
  const platform = process.platform
  if (platform !== 'win32' && platform !== 'linux') return
  const mark = (): void => {
    const root = document.documentElement
    root.dataset.desktopCaption = ''
    root.style.setProperty('--dsh-desktop-caption-height', `${DESKTOP_CAPTION_HEIGHT}px`)
  }
  // The root can be absent before the HTML parser creates it.
  if ((document.documentElement as HTMLElement | null) !== null) mark()
  const install = (): void => {
    mark()
    if (platform === 'linux') {
      installCaptionControls()
      return
    }
    const root = document.documentElement
    const menu = installWindowsMenu()
    const probe = document.createElement('span')
    probe.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;background-color:var(--dsw-specific-sidebar-fill);color:var(--dsw-alias-label-primary)'
    document.body.append(probe)
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 1
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (context === null) throw new Error('Desktop caption requires a 2D canvas context')
    const nativeColor = (color: string): string => {
      context.clearRect(0, 0, 1, 1)
      context.fillStyle = color
      context.fillRect(0, 0, 1, 1)
      const [red, green, blue, alpha] = context.getImageData(0, 0, 1, 1).data
      return `rgba(${red}, ${green}, ${blue}, ${Number(alpha) / 255})`
    }
    let previous = ''
    const send = (): void => {
      const style = getComputedStyle(probe)
      const color = nativeColor(style.backgroundColor)
      const symbolColor = nativeColor(style.color)
      const values = [root.lang, color, symbolColor]
      const current = JSON.stringify(values)
      if (current === previous) return
      previous = current
      menu.update()
      ipcRenderer.send(DESKTOP_IPC.windowsAppearance, ...values)
    }
    const observer = new MutationObserver(send)
    observer.observe(root, { attributes: true, attributeFilter: ['lang'] })
    observer.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme', 'style'] })
    observer.observe(document.head, { childList: true, subtree: true, characterData: true })
    document.head.addEventListener('load', send, true)
    window.addEventListener('pagehide', () => {
      observer.disconnect()
      menu.dispose()
      probe.remove()
      document.head.removeEventListener('load', send, true)
    }, { once: true })
    send()
  }
  if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', install, { once: true })
  else install()
}
