/**
 * Visual viewport tracking: publishes the visible viewport height and the
 * on-screen keyboard inset as root custom properties and marks
 * `html[data-keyboard-open]` while the keyboard covers more than
 * {@link KEYBOARD_OPEN_THRESHOLD} px. The phone shell sizes itself from the
 * visible height instead of the layout viewport, which an on-screen keyboard
 * does not shrink. Writes are coalesced through one animation frame; the
 * returned disposer detaches the listeners, cancels a queued write, and
 * restores the root values this tracker replaced.
 */

/** Root variable carrying the visible viewport height in px. */
export const VIEWPORT_HEIGHT_VARIABLE = '--dsh-viewport-height'

/** Root variable carrying the height the on-screen keyboard covers in px. */
export const KEYBOARD_INSET_VARIABLE = '--dsh-keyboard-inset'

/** Root attribute set while the on-screen keyboard covers the layout. */
export const KEYBOARD_OPEN_ATTRIBUTE = 'data-keyboard-open'

/** Uncovered height in px from which the keyboard counts as open. */
const KEYBOARD_OPEN_THRESHOLD = 80

/** Root variables this tracker owns. */
const ROOT_VARIABLES = [VIEWPORT_HEIGHT_VARIABLE, KEYBOARD_INSET_VARIABLE] as const

/**
 * Track the visual viewport until the returned disposer runs.
 *
 * Listens to `visualViewport` `resize`/`scroll` and to `window` `resize`,
 * falling back to `window.innerHeight` when the browser exposes no visual
 * viewport. Each update writes {@link VIEWPORT_HEIGHT_VARIABLE} and
 * {@link KEYBOARD_INSET_VARIABLE} on the document element and toggles
 * {@link KEYBOARD_OPEN_ATTRIBUTE}.
 * @returns a disposer that removes the listeners, cancels a pending frame, and
 *   restores the values and attribute state this tracker replaced.
 */
export function trackVisualViewport(): () => void {
  const root = document.documentElement
  const previous = ROOT_VARIABLES.map(name => ({
    name,
    value: root.style.getPropertyValue(name),
    priority: root.style.getPropertyPriority(name),
  }))
  const keyboardWasOpen = root.hasAttribute(KEYBOARD_OPEN_ATTRIBUTE)
  const viewport = window.visualViewport
  let frame: number | null = null
  let disposed = false

  const publish = (): void => {
    frame = null
    if (disposed) return
    const height = viewport?.height ?? window.innerHeight
    // The layout viewport keeps its full height while the keyboard rises, so
    // the uncovered band is the difference minus any visual-viewport offset.
    const inset = Math.max(0, window.innerHeight - height - (viewport?.offsetTop ?? 0))
    root.style.setProperty(VIEWPORT_HEIGHT_VARIABLE, `${Math.round(height)}px`)
    root.style.setProperty(KEYBOARD_INSET_VARIABLE, `${Math.round(inset)}px`)
    if (inset > KEYBOARD_OPEN_THRESHOLD) root.setAttribute(KEYBOARD_OPEN_ATTRIBUTE, '')
    else root.removeAttribute(KEYBOARD_OPEN_ATTRIBUTE)
  }
  const schedule = (): void => {
    if (disposed) return
    frame ??= requestAnimationFrame(publish)
  }

  publish()
  viewport?.addEventListener('resize', schedule)
  viewport?.addEventListener('scroll', schedule)
  window.addEventListener('resize', schedule)
  return () => {
    disposed = true
    if (frame !== null) cancelAnimationFrame(frame)
    viewport?.removeEventListener('resize', schedule)
    viewport?.removeEventListener('scroll', schedule)
    window.removeEventListener('resize', schedule)
    for (const { name, value, priority } of previous) {
      if (value === '') root.style.removeProperty(name)
      else root.style.setProperty(name, value, priority)
    }
    if (keyboardWasOpen) root.setAttribute(KEYBOARD_OPEN_ATTRIBUTE, '')
    else root.removeAttribute(KEYBOARD_OPEN_ATTRIBUTE)
  }
}
