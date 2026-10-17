// @vitest-environment jsdom
/** The workbench's two columns: the chips above the document, the tree beside it, and the divider. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { MenuItemButton } from '@deepseek-ai/dsh-client-ui-primitives'
import { FileTabs } from '../src/client/FileTabs.tsx'
import type { FileTabsProps } from '../src/client/FileTabs.tsx'
import { SplitView } from '../src/client/SplitView.tsx'
import { WorkbenchRail } from '../src/client/WorkbenchRail.tsx'
import { en as enCopy, zh } from '../src/client/locales.ts'

afterEach(() => { cleanup() })

const t = makeTranslate(zh)
/** The menu's copy is pinned in English, the wording the menu is specified with. */
const tEn = makeTranslate(enCopy)
const FILES = [
  { path: '/work/a.md', address: 'dsh-resource://file/session/s/a.md', name: 'a.md' },
  { path: '/work/b.ts', address: 'dsh-resource://file/session/s/b.ts', name: 'b.ts' },
]

/** The menu arms a chip render needs; each case replaces the ones it watches. */
const menuArms = {
  onCloseOthers: vi.fn(), onCloseAll: vi.fn(), onCloseLeft: vi.fn(), onCloseRight: vi.fn(),
}

/**
 * One chip strip carrying the shared arms.
 * @param props - the strip's own props, overriding the shared arms it watches.
 * @returns the element to render.
 */
function chipStrip(props: Pick<FileTabsProps, 'files' | 'active' | 't'> & Partial<Omit<FileTabsProps, 'files' | 'active' | 't'>>) {
  return <FileTabs onOpen={vi.fn()} onClose={vi.fn()} {...menuArms} {...props} />
}

describe('FileTabs', () => {
  it('draws nothing before a file is open', () => {
    const { container } = render(chipStrip({ files: [], active: undefined, t }))
    expect(container.querySelector('[data-files-tabs]')).toBeNull()
  })

  it('marks the shown file and reports the two gestures', () => {
    const onOpen = vi.fn()
    const onClose = vi.fn()
    const { container } = render(
      chipStrip({ files: FILES, active: FILES[1]!.path, t, onOpen, onClose }),
    )
    expect(container.querySelector(`[data-files-tab="${FILES[0]!.path}"] [aria-selected="false"]`)).not.toBeNull()
    expect(container.querySelector(`[data-files-tab="${FILES[1]!.path}"] [aria-selected="true"]`)).not.toBeNull()
    const open = container.querySelector<HTMLButtonElement>(`[data-files-tab-open="${FILES[0]!.path}"]`)!
    expect(open.querySelector('.tabName')?.getAttribute('title') ?? open.textContent).toBeTruthy()
    fireEvent.click(open)
    expect(onOpen).toHaveBeenCalledWith(FILES[0]!.path)
    fireEvent.click(container.querySelector(`[data-files-tab-close="${FILES[0]!.path}"]`)!)
    expect(onClose).toHaveBeenCalledWith(FILES[0]!.path)
  })

  it('scrolls horizontally on the wheel without drawing a scrollbar, and reveals the shown chip', () => {
    const { container, rerender } = render(chipStrip({ files: FILES, active: FILES[0]!.path, t }))
    const strip = container.querySelector<HTMLElement>('[data-files-tabs]')!
    // jsdom reports no layout: an overflowing row is stubbed, as is the chip's place.
    Object.defineProperty(strip, 'scrollWidth', { value: 400, configurable: true })
    Object.defineProperty(strip, 'clientWidth', { value: 100, configurable: true })
    strip.scrollLeft = 0
    const wheel = (init: WheelEventInit): WheelEvent => {
      const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, ...init })
      strip.dispatchEvent(event)
      return event
    }
    expect(wheel({ deltaY: 40 }).defaultPrevented).toBe(true)
    expect(strip.scrollLeft).toBe(40)
    // A horizontal gesture names its own axis, and the strip stops at its end.
    expect(wheel({ deltaX: 30 }).defaultPrevented).toBe(true)
    expect(strip.scrollLeft).toBe(70)
    wheel({ deltaY: 1000 })
    expect(strip.scrollLeft).toBe(300)
    expect(wheel({ deltaY: 10 }).defaultPrevented).toBe(false)
    expect(strip.scrollLeft).toBe(300)
    // A line-mode notch is a line of pixels.
    strip.scrollLeft = 0
    wheel({ deltaY: 3, deltaMode: WheelEvent.DOM_DELTA_LINE })
    expect(strip.scrollLeft).toBe(48)
    // A strip with nothing hidden keeps the notch for its ancestors.
    Object.defineProperty(strip, 'scrollWidth', { value: 100, configurable: true })
    expect(wheel({ deltaY: 40 }).defaultPrevented).toBe(false)

    // The shown chip is brought back when the chips or the shown file change.
    const chipBox = (left: number, right: number) => ({
      left, right, top: 0, bottom: 20, width: right - left, height: 20, x: left, y: 0, toJSON: () => ({}),
    })
    Object.defineProperty(strip, 'getBoundingClientRect', { value: () => chipBox(0, 100), configurable: true })
    Object.defineProperty(strip, 'scrollWidth', { value: 400, configurable: true })
    // The chips move with the strip: their boxes are the strip's offset by the scroll.
    const chips = [...strip.querySelectorAll<HTMLElement>('[data-files-tab]')]
    const chipAt = (left: number, right: number) => () =>
      chipBox(left - strip.scrollLeft, right - strip.scrollLeft)
    Object.defineProperty(chips[0]!, 'getBoundingClientRect', { value: chipAt(0, 60), configurable: true })
    Object.defineProperty(chips[1]!, 'getBoundingClientRect', { value: chipAt(140, 200), configurable: true })
    strip.scrollLeft = 0
    rerender(chipStrip({ files: FILES, active: FILES[1]!.path, t }))
    // The shown chip is kept 24px clear of the hidden edge's fade band.
    expect(strip.scrollLeft).toBe(124)
    // A chip inside the box moves nothing.
    strip.scrollLeft = 0
    rerender(chipStrip({ files: FILES, active: FILES[0]!.path, t }))
    expect(strip.scrollLeft).toBe(0)
    // A chip scrolled off the leading edge is brought back the other way.
    strip.scrollLeft = 250
    rerender(chipStrip({ files: FILES, active: FILES[1]!.path, t }))
    expect(strip.scrollLeft).toBe(116)
    // A shown path with no chip on the strip is ignored.
    strip.scrollLeft = 25
    rerender(chipStrip({ files: FILES, active: '/work/gone.md', t }))
    expect(strip.scrollLeft).toBe(25)
    // The hidden sides name the fade the stylesheet draws, and a scroll updates them.
    strip.scrollLeft = 0
    fireEvent.scroll(strip)
    expect(strip.getAttribute('data-files-tabs-scroll')).toBe('end')
    strip.scrollLeft = 150
    fireEvent.scroll(strip)
    expect(strip.getAttribute('data-files-tabs-scroll')).toBe('start end')
    strip.scrollLeft = 300
    fireEvent.scroll(strip)
    expect(strip.getAttribute('data-files-tabs-scroll')).toBe('start')
    // A row with nothing hidden names no side, and leaves the fade off.
    Object.defineProperty(strip, 'scrollWidth', { value: 100, configurable: true })
    strip.scrollLeft = 0
    fireEvent.scroll(strip)
    expect(strip.getAttribute('data-files-tabs-scroll')).toBeNull()
  })

  it('follows a strip resize when the platform reports one', () => {
    const observed: Element[] = []
    const disconnect = vi.fn()
    class FakeResizeObserver {
      constructor(private readonly callback: () => void) {}
      observe(element: Element): void { observed.push(element); this.callback() }
      disconnect(): void { disconnect() }
    }
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)
    try {
      const { container, unmount } = render(chipStrip({ files: FILES, active: FILES[0]!.path, t }))
      const strip = container.querySelector<HTMLElement>('[data-files-tabs]')!
      expect(observed).toEqual([strip])
      unmount()
      expect(disconnect).toHaveBeenCalledTimes(1)
      // An environment without the observer still reads the strip once.
      vi.stubGlobal('ResizeObserver', undefined)
      const fallback = render(chipStrip({ files: FILES, active: FILES[0]!.path, t }))
      expect(fallback.container.querySelector('[data-files-tabs]')).not.toBeNull()
      fallback.unmount()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('opens the chip menu on a secondary press and runs the arm each row names', () => {
    const arms = {
      onClose: vi.fn(), onCloseOthers: vi.fn(), onCloseAll: vi.fn(),
      onCloseLeft: vi.fn(), onCloseRight: vi.fn(),
    }
    const { container, getByRole } = render(chipStrip({ files: FILES, active: FILES[0]!.path, t: tEn, ...arms }))
    const chip = container.querySelector<HTMLElement>(`[data-files-tab="${FILES[1]!.path}"]`)!
    fireEvent.contextMenu(chip)
    const rows = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
    expect(rows.map(row => row.textContent)).toEqual([
      'Close', 'Close Other Tabs', 'Close All Tabs', 'Close Tabs to the Left', 'Close Tabs to the Right',
    ])
    // The right-hand chip leaves "to the right" with nothing to close.
    expect(rows[3]!.disabled).toBe(false)
    expect(rows[4]!.disabled).toBe(true)
    fireEvent.click(rows[0]!)
    expect(arms.onClose).toHaveBeenCalledWith(FILES[1]!.path)
    expect(document.querySelector('[role="menuitem"]')).toBeNull()

    fireEvent.contextMenu(chip)
    fireEvent.click(getByRole('menuitem', { name: 'Close Other Tabs' }))
    expect(arms.onCloseOthers).toHaveBeenCalledWith(FILES[1]!.path)
    fireEvent.contextMenu(chip)
    fireEvent.click(getByRole('menuitem', { name: 'Close All Tabs' }))
    expect(arms.onCloseAll).toHaveBeenCalledWith()
    fireEvent.contextMenu(chip)
    fireEvent.click(getByRole('menuitem', { name: 'Close Tabs to the Left' }))
    expect(arms.onCloseLeft).toHaveBeenCalledWith(FILES[1]!.path)
    // "To the right" is disabled on the right-hand chip, so it is exercised
    // from the left one, where the chips after it exist.
    fireEvent.contextMenu(container.querySelector<HTMLElement>(`[data-files-tab="${FILES[0]!.path}"]`)!)
    fireEvent.click(getByRole('menuitem', { name: 'Close Tabs to the Right' }))
    expect(arms.onCloseRight).toHaveBeenCalledWith(FILES[0]!.path)
    // Escape dismisses the menu without running an arm.
    const before = Object.values(arms).map(arm => arm.mock.calls.length)
    fireEvent.contextMenu(chip)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(document.querySelector('[role="menuitem"]')).toBeNull()
    expect(Object.values(arms).map(arm => arm.mock.calls.length)).toEqual(before)
  })

  it('disables the arms that would remove nothing', () => {
    const { container } = render(chipStrip({ files: [FILES[0]!], active: FILES[0]!.path, t: tEn }))
    fireEvent.contextMenu(container.querySelector<HTMLElement>(`[data-files-tab="${FILES[0]!.path}"]`)!)
    const rows = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
    expect(rows.map(row => [row.textContent, row.disabled])).toEqual([
      ['Close', false],
      ['Close Other Tabs', true],
      ['Close All Tabs', false],
      ['Close Tabs to the Left', true],
      ['Close Tabs to the Right', true],
    ])
  })

  it('renders the rows other plugins contribute and dismisses the menu when one is picked', () => {
    const onPicked = vi.fn()
    const picked = vi.fn()
    const { container } = render(chipStrip({
      files: FILES,
      active: FILES[0]!.path,
      t: tEn,
      renderMenuRow: (path, done) => (
        <button type="button" role="menuitem" data-contributed={path} onClick={() => { onPicked(); done(); picked(path) }}>
          Show file location
        </button>
      ),
    }))
    fireEvent.contextMenu(container.querySelector<HTMLElement>(`[data-files-tab="${FILES[1]!.path}"]`)!)
    const row = document.querySelector<HTMLElement>(`[data-contributed="${FILES[1]!.path}"]`)
    expect(row).not.toBeNull()
    // The contributed row follows the workbench's own arms.
    expect([...document.querySelectorAll('[role="menuitem"]')].at(-1)).toBe(row)
    fireEvent.click(row!)
    expect(picked).toHaveBeenCalledWith(FILES[1]!.path)
    expect(document.querySelector('[role="menuitem"]')).toBeNull()
  })

  it('walks the keyboard from the workbench arms into a contributed MenuItemButton', () => {
    const { container } = render(chipStrip({
      files: FILES,
      active: FILES[0]!.path,
      t: tEn,
      renderMenuRow: (path, done) => (
        <MenuItemButton onSelect={done}>{`Reveal ${path}`}</MenuItemButton>
      ),
    }))
    const chip = container.querySelector<HTMLElement>(`[data-files-tab="${FILES[0]!.path}"]`)!
    fireEvent.contextMenu(chip)
    // The walk enters from the trigger, so the keyboard starts on the chip.
    container.querySelector<HTMLElement>(`[data-files-tab-open="${FILES[0]!.path}"]`)!.focus()
    // End lands on the last reachable row, which is the contributed one: the
    // menu's keyboard walk treats contributed rows the same as its own arms.
    fireEvent.keyDown(document, { key: 'End' })
    expect(document.activeElement?.getAttribute('role')).toBe('menuitem')
    expect(document.activeElement?.textContent).toContain(`Reveal ${FILES[0]!.path}`)
  })

  it('closes on a middle click of the chip and ignores the other extra buttons', () => {
    const onClose = vi.fn()
    const { container } = render(chipStrip({ files: FILES, active: FILES[0]!.path, t, onClose }))
    const open = container.querySelector(`[data-files-tab-open="${FILES[0]!.path}"]`)!
    open.dispatchEvent(new MouseEvent('auxclick', { bubbles: true, button: 2 }))
    expect(onClose).not.toHaveBeenCalled()
    open.dispatchEvent(new MouseEvent('auxclick', { bubbles: true, button: 1 }))
    expect(onClose).toHaveBeenCalledWith(FILES[0]!.path)
  })
})

describe('WorkbenchRail', () => {
  it('marks the selected container and reports a press', () => {
    const onSelect = vi.fn()
    const { container, rerender } = render(<WorkbenchRail selected="files" onSelect={onSelect} t={t} />)
    const item = container.querySelector<HTMLElement>('[data-files-rail-item="files"]')!
    expect(item.getAttribute('aria-current')).toBe('page')
    fireEvent.click(item)
    expect(onSelect).toHaveBeenCalledWith('files')
    // A container that is not selected draws no current mark.
    rerender(<WorkbenchRail selected="search" onSelect={onSelect} t={t} />)
    expect(container.querySelector('[data-files-rail-item="files"]')?.getAttribute('aria-current')).toBeNull()
  })
})

describe('SplitView', () => {
  /** Render one workbench and stub the geometry jsdom does not compute. */
  function mount(ratio = 0.6) {
    const onRatio = vi.fn()
    const view = render(
      <SplitView
        ratio={ratio}
        onRatio={onRatio}
        content={<p data-test-content />}
        tree={<p data-test-tree />}
        label={zh['splitter.aria']}
      />,
    )
    const workbench = view.container.querySelector<HTMLElement>('[data-files-workbench]')!
    const splitter = view.container.querySelector<HTMLElement>('[data-files-splitter]')!
    const held = new Set<number>()
    const width = { value: 1000 }
    Object.defineProperty(workbench, 'getBoundingClientRect', {
      value: () => ({ left: 0, width: width.value, top: 0, right: width.value, bottom: 500, height: 500, x: 0, y: 0, toJSON: () => ({}) }),
    })
    splitter.setPointerCapture = (id: number) => { held.add(id) }
    splitter.releasePointerCapture = (id: number) => { held.delete(id) }
    splitter.hasPointerCapture = (id: number) => held.has(id)
    return { ...view, onRatio, splitter, workbench, width, release: (id: number) => { held.delete(id) } }
  }

  it('shows the given ratio and reports one settled value per drag', () => {
    const { container, onRatio, splitter } = mount(0.6)
    expect(container.querySelector<HTMLElement>('[data-files-content-column]')!.style.flexBasis).toBe('60%')
    // The separator is pointer-only: no value attributes are promised, because
    // keyboard resizing is future work the current control does not deliver.
    expect(splitter.getAttribute('role')).toBe('separator')
    expect(splitter.getAttribute('aria-valuenow')).toBeNull()
    fireEvent.pointerDown(splitter, { pointerId: 7, button: 0, clientX: 500 })
    fireEvent.pointerMove(splitter, { pointerId: 7, clientX: 700 })
    expect(container.querySelector<HTMLElement>('[data-files-content-column]')!.style.flexBasis).toBe('70%')
    expect(onRatio).not.toHaveBeenCalled()
    fireEvent.pointerUp(splitter, { pointerId: 7, clientX: 700 })
    expect(onRatio).toHaveBeenCalledExactlyOnceWith(0.7)
  })

  it('ignores a press without the primary button or without width, and a move after release', () => {
    const { onRatio, splitter, width, release } = mount()
    fireEvent.pointerDown(splitter, { pointerId: 1, button: 2, clientX: 500 })
    expect(splitter.hasPointerCapture(1)).toBe(false)
    width.value = 0
    fireEvent.pointerDown(splitter, { pointerId: 2, button: 0, clientX: 0 })
    expect(splitter.hasPointerCapture(2)).toBe(false)
    width.value = 1000
    fireEvent.pointerDown(splitter, { pointerId: 3, button: 0, clientX: 500 })
    fireEvent.pointerUp(splitter, { pointerId: 3, clientX: 500 })
    fireEvent.pointerMove(splitter, { pointerId: 3, clientX: 900 })
    expect(onRatio).toHaveBeenCalledTimes(1)
    // A cancelled gesture keeps the stored ratio instead of settling a new one.
    fireEvent.pointerDown(splitter, { pointerId: 4, button: 0, clientX: 500 })
    fireEvent.pointerMove(splitter, { pointerId: 4, clientX: 600 })
    fireEvent.pointerCancel(splitter, { pointerId: 4 })
    release(4)
    expect(onRatio).toHaveBeenCalledTimes(1)
    // Pointer capture no longer held means the gesture is over.
    fireEvent.pointerMove(splitter, { pointerId: 4, clientX: 800 })
    expect(onRatio).toHaveBeenCalledTimes(1)
    // A release without capture records nothing, and a box without width settles nothing.
    fireEvent.pointerUp(splitter, { pointerId: 5, clientX: 700 })
    expect(onRatio).toHaveBeenCalledTimes(1)
    fireEvent.pointerDown(splitter, { pointerId: 6, button: 0, clientX: 500 })
    width.value = 0
    fireEvent.pointerMove(splitter, { pointerId: 6, clientX: 900 })
    fireEvent.pointerUp(splitter, { pointerId: 6, clientX: 900 })
    expect(onRatio).toHaveBeenCalledTimes(1)
  })
})
