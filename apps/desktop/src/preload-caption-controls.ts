/** The Linux caption's drawn minimize, maximize/restore, and close controls. */
import { ipcRenderer } from 'electron'
import { CAPTION_CLOSE, CAPTION_MAXIMIZE, CAPTION_MINIMIZE, CAPTION_RESTORE, type CaptionGlyph } from './caption-glyphs.ts'
import { DESKTOP_IPC, type DesktopWindowControl } from './ipc.ts'
import { resolveDesktopLocale } from './locale.ts'

const GLYPH_SVG = 'http://www.w3.org/2000/svg'

/**
 * Build one caption control's glyph. The stroke inherits the button's color, so
 * hover and focus states need no separate glyph styling.
 * @param glyph - path the control draws.
 * @returns an SVG element sized to the caption row.
 */
function glyphElement(glyph: CaptionGlyph): SVGSVGElement {
  const svg = document.createElementNS(GLYPH_SVG, 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('width', '16')
  svg.setAttribute('height', '16')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', '1')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')
  svg.setAttribute('aria-hidden', 'true')
  const path = document.createElementNS(GLYPH_SVG, 'path')
  path.setAttribute('d', glyph.path)
  svg.append(path)
  return svg
}

/**
 * Mount the drawn caption controls and keep their labels and maximize glyph in
 * step with the application language and the window's state.
 *
 * The controls sit over the caption band's drag surface and subtract themselves
 * from it, so the band stays draggable everywhere the buttons are not. They
 * request window changes over IPC; the shell owns the window and decides what
 * closing means on this platform.
 * @returns Language refresh and document teardown operations.
 */
export function installCaptionControls(): { update(): void; dispose(): void } {
  const host = document.createElement('div')
  host.dataset.captionControls = ''
  const shadow = host.attachShadow({ mode: 'open' })
  const style = document.createElement('style')
  style.textContent = `
    :host { position: fixed; top: 0; right: 0; z-index: 1100;
      height: var(--dsh-desktop-caption-height, 40px); display: flex;
      -webkit-app-region: no-drag; }
    [role=group] { display: flex; align-items: stretch; }
    button { width: 44px; height: 100%; display: inline-flex; align-items: center;
      justify-content: center; padding: 0; border: 0; background: transparent;
      color: var(--dsw-alias-label-secondary); cursor: default; }
    button:hover { background: var(--dsw-alias-interactive-bg-hover);
      color: var(--dsw-alias-label-primary); }
    button:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: -2px; }
    :host-context(html[data-input-modality='pointer']) button:focus-visible { outline-color: transparent; }
    button[data-control='close']:hover { background: var(--dsw-alias-interactive-bg-hover-danger);
      color: var(--dsw-alias-state-error-primary); }
  `
  const group = document.createElement('div')
  group.setAttribute('role', 'group')

  const request = (control: DesktopWindowControl): void => {
    void Promise.resolve(ipcRenderer.invoke(DESKTOP_IPC.windowControl, control))
      .catch((error: unknown) => { console.error('Desktop caption control failed', error) })
  }
  const label = (button: HTMLButtonElement, text: string): void => {
    button.setAttribute('aria-label', text)
    button.title = text
  }

  const createButton = (control: DesktopWindowControl | 'maximize', glyph: CaptionGlyph): HTMLButtonElement => {
    const button = document.createElement('button')
    button.type = 'button'
    button.dataset.control = control
    // Preventing the default on pointer and mouse down keeps focus in the
    // editor behind the caption; the action itself fires on click.
    button.addEventListener('pointerdown', (event) => { event.preventDefault() })
    button.addEventListener('mousedown', (event) => { event.preventDefault() })
    button.append(glyphElement(glyph))
    button.addEventListener('click', () => {
      request(control === 'maximize' ? 'maximize-toggle' : control)
    })
    group.append(button)
    return button
  }

  const minimize = createButton('minimize', CAPTION_MINIMIZE)
  const maximize = createButton('maximize', CAPTION_MAXIMIZE)
  const close = createButton('close', CAPTION_CLOSE)
  const maximizePath = maximize.querySelector('path')
  /* v8 ignore next -- the control is built from glyphElement, which always appends a path. */
  if (maximizePath === null) throw new Error('Desktop caption control has no glyph')

  // The shell pushes the state after each change and after every page load; a
  // window that has not reported yet is windowed, which is the resting state.
  let maximized = false
  const onMaximized = (_event: Electron.IpcRendererEvent, value: boolean): void => {
    maximized = value
    applyState()
  }
  ipcRenderer.on(DESKTOP_IPC.windowMaximized, onMaximized)

  const applyState = (): void => {
    const { messages } = resolveDesktopLocale(document.documentElement.lang)
    const glyph = maximized ? CAPTION_RESTORE : CAPTION_MAXIMIZE
    maximizePath.setAttribute('d', glyph.path)
    label(maximize, messages[glyph.label])
    if (maximized) host.dataset.maximized = ''
    else delete host.dataset.maximized
  }

  shadow.append(style, group)
  const mount = (): void => {
    // AppFrame owns this seat; boot readiness alone precedes the rendered application.
    if (document.querySelector('[data-shell-overlay]') === null) return
    document.body.append(host)
    observer.disconnect()
  }
  const observer = new MutationObserver(mount)
  observer.observe(document.body, { childList: true, subtree: true })
  mount()

  const update = (): void => {
    const { messages } = resolveDesktopLocale(document.documentElement.lang)
    group.setAttribute('aria-label', messages.windowControls)
    label(minimize, messages.windowMinimize)
    label(close, messages.windowClose)
    applyState()
  }
  applyState()
  update()
  // Windows drives its caption refresh from the palette probe; the drawn
  // controls have no probe, so they follow the document language directly.
  const localeObserver = new MutationObserver(update)
  localeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] })

  return {
    update,
    dispose: () => {
      observer.disconnect()
      localeObserver.disconnect()
      ipcRenderer.off(DESKTOP_IPC.windowMaximized, onMaximized)
      host.remove()
    },
  }
}
