// @vitest-environment jsdom
/** Visual viewport tracker: published root values, frame coalescing, and retraction. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  KEYBOARD_INSET_VARIABLE, KEYBOARD_OPEN_ATTRIBUTE, trackVisualViewport, VIEWPORT_HEIGHT_VARIABLE,
} from '../src/client/visual-viewport.ts'

const ROOT_VARIABLES = [VIEWPORT_HEIGHT_VARIABLE, KEYBOARD_INSET_VARIABLE]

/** Minimal stand-in for the browser's VisualViewport. */
class FakeVisualViewport extends EventTarget {
  height: number
  offsetTop = 0
  constructor(height: number) {
    super()
    this.height = height
  }
}

let frames: Map<number, FrameRequestCallback>
let nextFrame: number

function flushFrames(): void {
  for (const [id, callback] of [...frames]) {
    if (!frames.delete(id)) continue
    callback(0)
  }
}

function root(): HTMLElement {
  return document.documentElement
}

function mount(height: number, innerHeight = height): { viewport: FakeVisualViewport; stop: () => void } {
  vi.stubGlobal('innerHeight', innerHeight)
  const viewport = new FakeVisualViewport(height)
  vi.stubGlobal('visualViewport', viewport)
  return { viewport, stop: trackVisualViewport() }
}

beforeEach(() => {
  frames = new Map()
  nextFrame = 1
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    const id = nextFrame++
    frames.set(id, callback)
    return id
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { frames.delete(id) })
})

afterEach(() => {
  for (const name of ROOT_VARIABLES) document.documentElement.style.removeProperty(name)
  document.documentElement.removeAttribute(KEYBOARD_OPEN_ATTRIBUTE)
  vi.unstubAllGlobals()
})

describe('trackVisualViewport', () => {
  it('publishes the visible height and a zero inset before any event', () => {
    const { stop } = mount(844)
    expect(root().style.getPropertyValue(VIEWPORT_HEIGHT_VARIABLE)).toBe('844px')
    expect(root().style.getPropertyValue(KEYBOARD_INSET_VARIABLE)).toBe('0px')
    expect(root().hasAttribute(KEYBOARD_OPEN_ATTRIBUTE)).toBe(false)
    stop()
  })

  it('coalesces resize and scroll notifications into one frame and follows the keyboard', () => {
    const { viewport, stop } = mount(844)
    viewport.height = 420
    viewport.dispatchEvent(new Event('resize'))
    viewport.dispatchEvent(new Event('scroll'))
    expect(frames.size).toBe(1)
    flushFrames()
    expect(root().style.getPropertyValue(VIEWPORT_HEIGHT_VARIABLE)).toBe('420px')
    expect(root().style.getPropertyValue(KEYBOARD_INSET_VARIABLE)).toBe('424px')
    expect(root().hasAttribute(KEYBOARD_OPEN_ATTRIBUTE)).toBe(true)

    // Closing the keyboard retracts both the inset and the marker.
    viewport.height = 844
    viewport.dispatchEvent(new Event('resize'))
    flushFrames()
    expect(root().style.getPropertyValue(KEYBOARD_INSET_VARIABLE)).toBe('0px')
    expect(root().hasAttribute(KEYBOARD_OPEN_ATTRIBUTE)).toBe(false)
    stop()
  })

  it('subtracts the visual viewport offset and keeps sub-threshold insets unmarked', () => {
    const { viewport, stop } = mount(844)
    viewport.height = 800
    viewport.offsetTop = 0
    viewport.dispatchEvent(new Event('resize'))
    flushFrames()
    expect(root().style.getPropertyValue(KEYBOARD_INSET_VARIABLE)).toBe('44px')
    expect(root().hasAttribute(KEYBOARD_OPEN_ATTRIBUTE)).toBe(false)

    viewport.height = 600
    viewport.offsetTop = 44
    viewport.dispatchEvent(new Event('resize'))
    flushFrames()
    expect(root().style.getPropertyValue(KEYBOARD_INSET_VARIABLE)).toBe('200px')
    expect(root().hasAttribute(KEYBOARD_OPEN_ATTRIBUTE)).toBe(true)
    stop()
  })

  it('falls back to the layout viewport height without a visual viewport', () => {
    vi.stubGlobal('visualViewport', undefined)
    vi.stubGlobal('innerHeight', 700)
    const stop = trackVisualViewport()
    expect(root().style.getPropertyValue(VIEWPORT_HEIGHT_VARIABLE)).toBe('700px')
    expect(root().style.getPropertyValue(KEYBOARD_INSET_VARIABLE)).toBe('0px')

    vi.stubGlobal('innerHeight', 500)
    window.dispatchEvent(new Event('resize'))
    expect(frames.size).toBe(1)
    flushFrames()
    expect(root().style.getPropertyValue(VIEWPORT_HEIGHT_VARIABLE)).toBe('500px')
    expect(root().style.getPropertyValue(KEYBOARD_INSET_VARIABLE)).toBe('0px')
    expect(root().hasAttribute(KEYBOARD_OPEN_ATTRIBUTE)).toBe(false)
    stop()
  })

  it('restores replaced values, detaches the listeners, and drops a queued frame on dispose', () => {
    root().style.setProperty(VIEWPORT_HEIGHT_VARIABLE, '999px', 'important')
    root().setAttribute(KEYBOARD_OPEN_ATTRIBUTE, '')
    const { viewport, stop } = mount(844)
    expect(root().style.getPropertyValue(VIEWPORT_HEIGHT_VARIABLE)).toBe('844px')

    viewport.height = 400
    viewport.dispatchEvent(new Event('resize'))
    expect(frames.size).toBe(1)
    stop()
    expect(frames.size).toBe(0)
    expect(root().style.getPropertyValue(VIEWPORT_HEIGHT_VARIABLE)).toBe('999px')
    expect(root().style.getPropertyPriority(VIEWPORT_HEIGHT_VARIABLE)).toBe('important')
    expect(root().style.getPropertyValue(KEYBOARD_INSET_VARIABLE)).toBe('')
    // The pre-existing marker is restored rather than silently dropped.
    expect(root().hasAttribute(KEYBOARD_OPEN_ATTRIBUTE)).toBe(true)

    viewport.dispatchEvent(new Event('resize'))
    window.dispatchEvent(new Event('resize'))
    expect(frames.size).toBe(0)
  })
})
