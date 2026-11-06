// @vitest-environment jsdom
/** The files workbench and its tree, over controlled directory watches and deferred listings. */
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import type { Mock } from 'vitest'
import { act, cleanup, fireEvent, screen, within } from '@testing-library/react'
import { makeTranslate, RemoteError } from '@deepseek-ai/dsh-client-test-runtime'
import type { RemoteFailure } from '@deepseek-ai/dsh-api-remotes/client'
import { fileAddressFor } from '@deepseek-ai/dsh-util-workspace-path'
import { failureLine } from '../src/client/workspace-tree.ts'
import type { DirLevel } from '../src/client/store.ts'
import { zh } from '../src/client/locales.ts'
import { mountBody, PANE, ROOT, SESSION, TAB } from './mount.client.tsx'

const ROOT_LEVEL: DirLevel = {
  entries: [
    { name: 'README.md', type: 'file', size: 12 },
    { name: 'src', type: 'directory' },
    { name: '.env', type: 'file', size: 2 },
    { name: 'pipe', type: 'other' },
  ],
  truncated: false,
}

// jsdom has no scrolling into view; opening a file reveals its row.
beforeEach(() => { Element.prototype.scrollIntoView = vi.fn() })
afterEach(() => {
  cleanup()
  Reflect.deleteProperty(Element.prototype, 'scrollIntoView')
})

/** Row labels in document order. */
function names(root: HTMLElement): string[] {
  return [...root.querySelectorAll('[data-files-entry]')].map(li => li.getAttribute('data-files-path')!)
}

/**
 * The latest menu gesture the page raised.
 * @param openMenu - the harness's shared menu opener.
 * @returns the captured target and the point the menu opens at.
 */
function lastMenu(openMenu: Mock): {
  readonly target: { readonly kind: string; readonly value: object }
  readonly point: { readonly x: number; readonly y: number }
} {
  const call = openMenu.mock.lastCall
  if (call === undefined) throw new Error('expected a menu gesture')
  const [target, point] = call as [{ kind: string; value: object }, { x: number; y: number }]
  return { target, point }
}

/**
 * A ResizeObserver the spec fires by hand, found by the element it watches.
 * @returns the class to stub and a lookup for the observer of one element.
 */
function resizeObserver() {
  interface HandMade {
    readonly observed: Element[]
    readonly unobserve: () => void
    readonly disconnect: () => void
    fire(width: number): void
  }
  const instances: HandMade[] = []
  class FakeResizeObserver implements ResizeObserver {
    readonly observed: Element[] = []
    readonly unobserve = vi.fn()
    readonly disconnect = vi.fn()
    private readonly callback: ResizeObserverCallback
    constructor(callback: ResizeObserverCallback) {
      this.callback = callback
      instances.push(this)
    }

    readonly observe = vi.fn((element: Element) => { this.observed.push(element) })

    fire(width: number): void {
      this.callback([{ contentRect: { width } } as ResizeObserverEntry], this)
    }
  }
  return {
    type: FakeResizeObserver,
    for: (element: Element): HandMade => {
      const found = instances.find(candidate => candidate.observed.includes(element))
      if (found === undefined) throw new Error('expected the workbench to measure that element')
      return found
    },
  }
}

describe('FilesBody', () => {
  it('displays the effective file-tree refresh accelerator', async () => {
    const { view, script } = mountBody(ROOT, { refreshShortcut: { id: 'page.refresh' as never, label: 'Refresh', aliases: [],
      binding: null, keys: ['Ctrl', 'R'], aria: 'Control+R', modified: true, conflicts: [], issue: null } })
    await act(() => script.watches.ready(ROOT))
    await act(() => script.settle({ ok: true, value: ROOT_LEVEL }))
    expect(view.getByRole('button', { name: zh.reload }).getAttribute('aria-keyshortcuts')).toBe('Control+R')
  })
  it('says so when the session has no workspace directory, and asks for nothing', () => {
    const { view, script } = mountBody(null)
    expect(view.container.querySelector('[data-files-state="no-workspace"]')?.textContent).toBe(zh.noWorkspace)
    expect(script.list).not.toHaveBeenCalled()
  })

  it('heads the page with the root and reload, and fills the tree column with a headerless tree that stays shown', async () => {
    const viewport = { matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }
    vi.stubGlobal('matchMedia', () => viewport)
    onTestFinished(() => { vi.unstubAllGlobals() })
    const { view, script, instance, tabActions } = mountBody()
    expect(viewport.addEventListener).not.toHaveBeenCalled()
    await act(() => script.watches.ready(ROOT))
    const page = view.container.querySelector('[data-files-page]')!
    const header = page.firstElementChild!
    expect(header.querySelector('[data-files-path]')?.getAttribute('title')).toBe(ROOT)
    expect([...header.querySelectorAll('button:not([data-files-auto-refresh])')].map(button => button.getAttribute('aria-label')))
      .toEqual([zh.reload])
    const content = page.querySelector('[data-files-content]')!
    expect(content.children).toHaveLength(1)
    const navigator = content.firstElementChild!
    expect(navigator.getAttribute('data-files-navigator')).toBe(PANE)
    expect(navigator.querySelector('[data-files-reload], [data-files-path]:not(li)')).toBeNull()
    // The tree fills its column: it neither floats nor draws a resize edge; the workbench's divider sizes the column.
    expect(navigator.hasAttribute('data-files-navigator-mode')).toBe(false)
    expect(navigator.querySelector('[role="separator"]')).toBeNull()
    expect(view.container.querySelector('[data-files-navigator-toggle]')).toBeNull()
    // Escape and a hidden choice for the pane leave the page's tree shown.
    fireEvent.keyDown(navigator, { key: 'Escape' })
    act(() => { instance.actions.shown(PANE, false) })
    expect(view.container.querySelector('[data-files-navigator]')).not.toBeNull()
    expect(view.getByRole('button', { name: zh.reload }).hasAttribute('disabled')).toBe(false)
    const bound = tabActions.bindCommands.mock.lastCall?.[0]
    expect(typeof bound?.refresh).toBe('function')
  })

  it('lists the root on mount, heads it with its path split at the last segment, and draws directories first with dotfiles kept', async () => {
    const { view, script } = mountBody()
    expect(script.list).not.toHaveBeenCalled()
    await act(() => script.watches.ready(ROOT))
    expect(script.list).toHaveBeenCalledWith(SESSION, ROOT, expect.any(AbortSignal))
    expect(view.container.querySelector('[data-files-row="loading"]')).not.toBeNull()
    await act(() => script.settle({ ok: true, value: ROOT_LEVEL }))
    expect(view.container.querySelector('[data-files-state="tree"]')?.getAttribute('data-files-root')).toBe(ROOT)
    const path = view.container.querySelector('[data-files-path]')
    expect(path?.getAttribute('title')).toBe(ROOT)
    expect([...path?.firstElementChild?.children ?? []].map(span => span.textContent)).toEqual(['/work/', 'app'])
    expect(names(view.container)).toEqual([`${ROOT}/src`, `${ROOT}/.env`, `${ROOT}/pipe`, `${ROOT}/README.md`])
    const envIcon = view.container.querySelector(`[data-files-path="${ROOT}/.env"] svg`)?.innerHTML
    const readmeIcon = view.container.querySelector(`[data-files-path="${ROOT}/README.md"] svg`)?.innerHTML
    expect(envIcon).not.toBe(readmeIcon)
  })

  it('heads a separator-only root by the root itself, since it has no final segment', async () => {
    const { view, script } = mountBody('/')
    await act(() => script.watches.ready('/'))
    await act(() => script.settle({ ok: true, value: ROOT_LEVEL }))
    const path = view.container.querySelector('[data-files-path]')
    expect([...path?.firstElementChild?.children ?? []].map(span => span.textContent)).toEqual(['/'])
    expect(names(view.container)).toEqual(['/src', '/.env', '/pipe', '/README.md'])
  })

  it('marks the root path clipped while its text is wider than its box, re-reading on resize', async () => {
    class FakeResizeObserver implements ResizeObserver {
      static readonly instances: FakeResizeObserver[] = []
      readonly observe = vi.fn()
      readonly unobserve = vi.fn()
      readonly disconnect = vi.fn()
      constructor(private readonly callback: ResizeObserverCallback) {
        FakeResizeObserver.instances.push(this)
      }

      fire(): void {
        this.callback([], this)
      }
    }
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)
    let boxWidth = 300
    const offsetWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth')
    const clientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth')
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get: () => 200 })
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => boxWidth })
    try {
      const { view, script } = mountBody()
      await act(() => script.watches.ready(ROOT))
      await act(() => script.settle({ ok: true, value: ROOT_LEVEL }))
      const path = view.container.querySelector<HTMLElement>('[data-files-path]')
      const text = path?.firstElementChild
      expect(path?.hasAttribute('data-path-clipped')).toBe(false)
      // The workbench observes its container and the navigator its row; the path label observes itself.
      const observer = FakeResizeObserver.instances.find(candidate => candidate.observe.mock.calls.some(([target]) => target === path))
      if (observer === undefined) throw new Error('expected the path to observe its size')
      expect(observer.observe).toHaveBeenCalledWith(path)
      expect(observer.observe).toHaveBeenCalledWith(text)

      boxWidth = 120
      act(() => { observer.fire() })
      expect(path?.hasAttribute('data-path-clipped')).toBe(true)

      boxWidth = 300
      act(() => { observer.fire() })
      expect(path?.hasAttribute('data-path-clipped')).toBe(false)
      view.unmount()
      expect(observer.disconnect).toHaveBeenCalledTimes(1)
    } finally {
      vi.unstubAllGlobals()
      for (const [name, descriptor] of [['offsetWidth', offsetWidth], ['clientWidth', clientWidth]] as const) {
        if (descriptor === undefined) Reflect.deleteProperty(HTMLElement.prototype, name)
        else Object.defineProperty(HTMLElement.prototype, name, descriptor)
      }
    }
  })

  it('reopening a directory shows its cache and replaces it after the new subscription is ready', async () => {
    const { view, script } = mountBody()
    await act(() => script.watches.ready(ROOT))
    await act(() => script.settle({ ok: true, value: ROOT_LEVEL }))
    const dir = within(view.container.querySelector<HTMLElement>(`[data-files-path="${ROOT}/src"]`)!).getByRole('button', { name: 'src' })
    act(() => { fireEvent.click(dir) })
    expect(script.list).toHaveBeenCalledTimes(1)
    const childStream = await act(() => script.watches.ready(`${ROOT}/src`))
    expect(script.list).toHaveBeenLastCalledWith(SESSION, `${ROOT}/src`, expect.any(AbortSignal))
    expect(dir.getAttribute('aria-expanded')).toBe('true')
    await act(() => script.settle({ ok: true, value: { entries: [{ name: 'a.ts', type: 'file' }], truncated: false } }))
    expect(names(view.container)).toContain(`${ROOT}/src/a.ts`)
    act(() => { fireEvent.click(dir) })
    expect(childStream.signal.aborted).toBe(true)
    await childStream.released.promise
    expect(dir.getAttribute('aria-expanded')).toBe('false')
    expect(names(view.container)).not.toContain(`${ROOT}/src/a.ts`)
    act(() => { fireEvent.click(dir) })
    expect(names(view.container)).toContain(`${ROOT}/src/a.ts`)
    expect(script.list).toHaveBeenCalledTimes(2)
    await act(() => script.watches.ready(`${ROOT}/src`, 1))
    expect(script.list).toHaveBeenCalledTimes(3)
    expect(names(view.container)).toContain(`${ROOT}/src/a.ts`)
    await act(() => script.settle({ ok: true, value: { entries: [{ name: 'b.ts', type: 'file' }], truncated: false } }))
    expect(names(view.container)).toContain(`${ROOT}/src/b.ts`)
    expect(names(view.container)).not.toContain(`${ROOT}/src/a.ts`)
  })

  it('a file click opens a chip and shows it through the shared preview; an other entry offers no button', async () => {
    const { view, script, renderSlot, tabActions, instance } = mountBody()
    await act(() => script.watches.ready(ROOT))
    await act(() => script.settle({ ok: true, value: ROOT_LEVEL }))
    expect(view.container.querySelector('[data-files-preview-state="empty"]')?.textContent).toBe(zh['preview.empty'])
    const row = (name: string): HTMLElement =>
      within(view.container.querySelector<HTMLElement>(`[data-files-path="${ROOT}/${name}"]`)!).getByRole('button', { name })
    fireEvent.click(row('README.md'))
    // Every row sits under the tree's root, so the address is the session-scoped one.
    const address = fileAddressFor(SESSION, ROOT, `${ROOT}/README.md`)
    expect(view.container.querySelector(`[data-files-tab="${ROOT}/README.md"]`)).not.toBeNull()
    // The preview seat's fill draws the file, keyed per tab and file, for the chip's own lifetime.
    const preview = renderSlot.mock.calls.filter(([name]) => name === 'sidebar.right.tab.files.preview').at(-1)
    expect(preview?.[1]).toMatchObject({
      address, viewKey: `${TAB}:${ROOT}/README.md`, navigation: { address, params: undefined, revision: 1 },
      signal: expect.any(AbortSignal) as AbortSignal, paneId: PANE,
    })
    expect(view.container.querySelector('[data-preview-address]')?.getAttribute('data-preview-address')).toBe(address)
    // The page opens no tab and writes no tree choice for its pane.
    expect(tabActions.openResource).not.toHaveBeenCalled()
    expect(instance.getSnapshot().byPane[PANE]?.open).toBeUndefined()
    expect(view.container.querySelector('[data-files-navigator]')).not.toBeNull()
    // The row marks the file the content column shows.
    expect(view.container.querySelector(`[data-files-path="${ROOT}/README.md"] [aria-current="true"]`)).not.toBeNull()
    // Opening the same file again keeps one chip; another file joins it and takes the column.
    fireEvent.click(row('README.md'))
    fireEvent.click(row('.env'))
    expect(view.container.querySelectorAll('[data-files-tab]')).toHaveLength(2)
    expect(view.container.querySelector(`[data-files-tab="${ROOT}/.env"] [aria-selected="true"]`))
      .not.toBeNull()
    // Clicking a chip shows that file without changing the chips.
    fireEvent.click(view.container.querySelector(`[data-files-tab-open="${ROOT}/README.md"]`)!)
    expect(view.container.querySelector(`[data-files-tab="${ROOT}/README.md"] [aria-selected="true"]`)).not.toBeNull()
    fireEvent.click(view.container.querySelector(`[data-files-tab-open="${ROOT}/.env"]`)!)
    // Closing the shown chip shows its neighbour; closing the last one empties the column.
    fireEvent.click(view.container.querySelector(`[data-files-tab-close="${ROOT}/.env"]`)!)
    expect(view.container.querySelectorAll('[data-files-tab]')).toHaveLength(1)
    expect(view.container.querySelector(`[data-files-tab="${ROOT}/README.md"] [aria-selected="true"]`))
      .not.toBeNull()
    fireEvent.click(view.container.querySelector(`[data-files-tab-close="${ROOT}/README.md"]`)!)
    expect(view.container.querySelectorAll('[data-files-tab]')).toHaveLength(0)
    expect(view.container.querySelector('[data-files-preview-state="empty"]')).not.toBeNull()
    const other = view.container.querySelector(`[data-files-path="${ROOT}/pipe"]`)!
    expect(other.querySelector('button')).toBeNull()
    expect(other.querySelector('[aria-disabled="true"]')?.getAttribute('title')).toBe(zh['entry.other'])
  })

  it('closes chips in bulk from the chip menu', async () => {
    const { view, script, instance } = mountBody()
    await act(() => script.watches.ready(ROOT))
    await act(() => script.settle({ ok: true, value: ROOT_LEVEL }))
    for (const name of ['README.md', '.env']) {
      fireEvent.click(view.container.querySelector(`[data-files-path="${ROOT}/${name}"] button`)!)
    }
    const chip = view.container.querySelector<HTMLElement>(`[data-files-tab="${ROOT}/README.md"]`)!
    const open = (): readonly string[] => (instance.getSnapshot().byTab[TAB]?.open ?? []).map(file => file.path)
    fireEvent.contextMenu(chip)
    fireEvent.click(screen.getByRole('menuitem', { name: '关闭其他标签页' }))
    expect(open()).toEqual([`${ROOT}/README.md`])
    for (const name of ['.env']) {
      fireEvent.click(view.container.querySelector(`[data-files-path="${ROOT}/${name}"] button`)!)
    }
    fireEvent.contextMenu(view.container.querySelector<HTMLElement>(`[data-files-tab="${ROOT}/.env"]`)!)
    fireEvent.click(screen.getByRole('menuitem', { name: '关闭左侧标签页' }))
    expect(open()).toEqual([`${ROOT}/.env`])
    fireEvent.click(view.container.querySelector(`[data-files-path="${ROOT}/README.md"] button`)!)
    fireEvent.contextMenu(view.container.querySelector<HTMLElement>(`[data-files-tab="${ROOT}/.env"]`)!)
    fireEvent.click(screen.getByRole('menuitem', { name: '关闭右侧标签页' }))
    expect(open()).toEqual([`${ROOT}/.env`])
    fireEvent.contextMenu(view.container.querySelector<HTMLElement>(`[data-files-tab="${ROOT}/.env"]`)!)
    fireEvent.click(screen.getByRole('menuitem', { name: '关闭所有标签页' }))
    expect(open()).toEqual([])
    expect(view.container.querySelector('[data-files-preview-state="empty"]')).not.toBeNull()
  })

  it('ends a closed chip\'s preview lifetime and leaves its siblings\' open', async () => {
    const { view, script, face } = mountBody()
    await act(() => script.watches.ready(ROOT))
    await act(() => script.settle({ ok: true, value: ROOT_LEVEL }))
    for (const name of ['README.md', '.env']) {
      fireEvent.click(view.container.querySelector(`[data-files-path="${ROOT}/${name}"] button`)!)
    }
    const readme = face.chipSignal(TAB, `${ROOT}/README.md`, { aborted: false } as AbortSignal)
    const env = face.chipSignal(TAB, `${ROOT}/.env`, { aborted: false } as AbortSignal)
    // The same chip receives the identical signal across re-renders.
    expect(face.chipSignal(TAB, `${ROOT}/README.md`, { aborted: false } as AbortSignal)).toBe(readme)
    fireEvent.click(view.container.querySelector(`[data-files-tab-close="${ROOT}/README.md"]`)!)
    expect(readme.aborted).toBe(true)
    expect(env.aborted).toBe(false)
    // A bulk close ends every removed chip's lifetime.
    fireEvent.contextMenu(view.container.querySelector<HTMLElement>(`[data-files-tab="${ROOT}/.env"]`)!)
    fireEvent.click(screen.getByRole('menuitem', { name: '关闭所有标签页' }))
    expect(env.aborted).toBe(true)
  })

  it('draws the activity rail with the folder container selected', async () => {
    const { view, script } = mountBody()
    await act(() => script.watches.ready(ROOT))
    await act(() => script.settle({ ok: true, value: ROOT_LEVEL }))
    const rail = view.container.querySelector<HTMLElement>('[data-files-rail]')!
    expect(rail.getAttribute('role')).toBe('toolbar')
    expect(rail.getAttribute('aria-label')).toBe(zh['rail.aria'])
    const items = [...rail.querySelectorAll<HTMLElement>('[data-files-rail-item]')]
    // The failed working-tree probe keeps the git and history containers'
    // retries reachable.
    expect(items.map(item => item.dataset.filesRailItem)).toEqual(['files', 'git', 'history'])
    expect(items[0]!.getAttribute('aria-label')).toBe(zh['rail.files'])
    expect(items[0]!.getAttribute('aria-current')).toBe('page')
    expect(items[1]!.getAttribute('aria-label')).toBe(zh['rail.git'])
    expect(items[1]!.getAttribute('aria-current')).toBeNull()
    expect(items[2]!.getAttribute('aria-label')).toBe(zh['rail.history'])
    expect(items[2]!.getAttribute('aria-current')).toBeNull()
    expect(items[0]!.textContent).toBe('')
    // It is the workbench's trailing edge: after both columns, not before them.
    const row = rail.parentElement!
    expect(row.lastElementChild).toBe(rail)
    expect(row.querySelector('[data-files-content-column]')).not.toBeNull()
  })

  it('heads the tree panel with its title and two icon actions', async () => {
    const { view, script } = mountBody()
    await act(() => script.watches.ready(ROOT))
    await act(() => script.settle({ ok: true, value: ROOT_LEVEL }))
    const header = view.container.querySelector<HTMLElement>('[data-files-tree-header]')!
    expect(header.querySelector('[data-files-tree-title]')?.textContent).toBe(zh['tree.title'])
    const actions = [...header.querySelectorAll<HTMLButtonElement>('[data-files-tree-action]')]
    expect(actions.map(action => action.dataset.filesTreeAction)).toEqual(['expand', 'collapse'])
    expect(actions.map(action => action.getAttribute('aria-label'))).toEqual([
      zh['tree.expand'], zh['tree.collapse'],
    ])
    expect(actions.map(action => action.disabled)).toEqual([false, false])
  })

  it('expands every listed directory and collapses them all again', async () => {
    const { view, script, instance } = mountBody()
    await act(() => script.watches.ready(ROOT))
    await act(() => script.settle({ ok: true, value: ROOT_LEVEL }))
    fireEvent.click(view.container.querySelector('[data-files-tree-action="expand"]')!)
    const src = await act(() => script.watches.ready(`${ROOT}/src`))
    expect(src.path).toBe(`${ROOT}/src`)
    await act(() => script.settle({ ok: true, value: { entries: [{ name: 'a.ts', type: 'file' }], truncated: false } }))
    expect(instance.getSnapshot().byPane[PANE]?.tree?.expanded).toContain(`${ROOT}/src`)
    expect(view.container.querySelector(`[data-files-path="${ROOT}/src/a.ts"]`)).not.toBeNull()
    // Collapse all keeps the root open and drops every nested row.
    fireEvent.click(view.container.querySelector('[data-files-tree-action="collapse"]')!)
    expect(instance.getSnapshot().byPane[PANE]?.tree?.expanded).toEqual([ROOT])
    expect(view.container.querySelector(`[data-files-path="${ROOT}/src/a.ts"]`)).toBeNull()
    expect(view.container.querySelector(`[data-files-path="${ROOT}/src"] button`)?.getAttribute('aria-expanded')).toBe('false')
  })

  it('selects the rail container and skips expanding levels it cannot read', async () => {
    const { view, script, instance } = mountBody()
    const rail = view.container.querySelector<HTMLElement>('[data-files-rail-item="files"]')!
    fireEvent.click(rail)
    expect(instance.getSnapshot().byTab[TAB]?.container).toBe('files')
    // While the root listing is still in flight, expand-all has no ready level to open.
    await act(() => script.watches.ready(ROOT))
    fireEvent.click(view.container.querySelector('[data-files-tree-action="expand"]')!)
    expect(instance.getSnapshot().byPane[PANE]?.tree?.expanded).toEqual([ROOT])
    await act(() => script.settle({ ok: true, value: ROOT_LEVEL }))
    // A directory already open is left alone by a second press.
    fireEvent.click(view.container.querySelector('[data-files-tree-action="expand"]')!)
    await act(() => script.watches.ready(`${ROOT}/src`))
    await act(() => script.settle({ ok: true, value: { entries: [], truncated: false } }))
    fireEvent.click(view.container.querySelector('[data-files-tree-action="expand"]')!)
    expect(script.outstanding()).toEqual([])
  })

  it('renders the chip actions slot in the open menu and lets its row dismiss the menu', async () => {
    const { view, script, renderSlot } = mountBody()
    await act(() => script.watches.ready(ROOT))
    await act(() => script.settle({ ok: true, value: ROOT_LEVEL }))
    fireEvent.click(view.container.querySelector(`[data-files-path="${ROOT}/README.md"] button`)!)
    fireEvent.contextMenu(view.container.querySelector<HTMLElement>(`[data-files-tab="${ROOT}/README.md"]`)!)
    expect(renderSlot.mock.calls.map(call => String(call[0]))).toContain('sidebar.right.tab.files.chip.actions')
    const row = document.querySelector<HTMLElement>(`[data-chip-row="${ROOT}/README.md"]`)
    expect(row).not.toBeNull()
    fireEvent.click(row!)
    expect(document.querySelector('[role="menuitem"]')).toBeNull()
  })

  it('opens the clicked file menu in its pane without activating the file', async () => {
    const h = mountBody()
    await act(() => h.script.watches.ready(ROOT))
    await act(() => h.script.settle({ ok: true, value: ROOT_LEVEL }))
    const row = h.view.container.querySelector(`[data-files-path="${ROOT}/README.md"] button`)!
    fireEvent.contextMenu(row, { clientX: 45, clientY: 56 })
    expect(h.shared.openMenu).toHaveBeenCalledWith({ kind: 'file', value: { sessionId: SESSION, path: `${ROOT}/README.md`, paneId: 'pane-1' } }, { x: 45, y: 56 })
    expect(h.tabActions.openResource).not.toHaveBeenCalled()
    expect(h.view.container.querySelector('[data-files-tab]')).toBeNull()
  })

  it('opens menus for a collapsed folder and the root without expanding or activating a file', async () => {
    const h = mountBody()
    await act(() => h.script.watches.ready(ROOT))
    await act(() => h.script.settle({ ok: true, value: ROOT_LEVEL }))
    const folder = h.view.getByRole('button', { name: 'src' })
    fireEvent.contextMenu(folder, { clientX: 20, clientY: 30 })
    expect(h.shared.openMenu).toHaveBeenLastCalledWith({ kind: 'directory', value: { sessionId: SESSION, path: `${ROOT}/src` } }, { x: 20, y: 30 })
    expect(folder.getAttribute('aria-expanded')).toBe('false')
    fireEvent.contextMenu(h.view.container.querySelector('[data-path-label]')!, { clientX: 10, clientY: 15 })
    expect(h.shared.openMenu).toHaveBeenLastCalledWith({ kind: 'directory', value: { sessionId: SESSION, path: ROOT } }, { x: 10, y: 15 })
    expect(h.tabActions.openResource).not.toHaveBeenCalled()
  })

  it('records a file row\'s own open gesture and its relative path for the menu its press opens', async () => {
    const h = mountBody()
    await act(() => h.script.watches.ready(ROOT))
    await act(() => h.script.settle({ ok: true, value: ROOT_LEVEL }))
    fireEvent.contextMenu(h.view.container.querySelector(`[data-files-path="${ROOT}/README.md"] button`)!, { clientX: 120, clientY: 240 })
    // The menu opens where the press landed rather than at the row's edge.
    const { target, point } = lastMenu(h.shared.openMenu)
    expect(point).toEqual({ x: 120, y: 240 })
    // The plugin's file arms read what the press recorded against the target it raised.
    const arms = h.rows.get(target.value)
    if (arms?.kind !== 'file') throw new Error('expected the press to record the file row\'s arms')
    expect(arms.relativePath).toBe('README.md')
    expect(h.view.container.querySelector('[data-files-tab]')).toBeNull()
    // The open arm is the row's own click: a chip opens and the column shows the file.
    act(() => { arms.open() })
    expect(h.view.container.querySelector(`[data-files-tab="${ROOT}/README.md"] [aria-selected="true"]`)).not.toBeNull()
  })

  it('records a directory row\'s toggle as the row stood when its menu opened', async () => {
    const h = mountBody()
    await act(() => h.script.watches.ready(ROOT))
    await act(() => h.script.settle({ ok: true, value: ROOT_LEVEL }))
    const row = h.view.container.querySelector<HTMLElement>(`[data-files-path="${ROOT}/src"] button`)!
    fireEvent.contextMenu(row)
    const expand = h.rows.get(lastMenu(h.shared.openMenu).target.value)
    if (expand?.kind !== 'directory') throw new Error('expected the press to record the directory row\'s arms')
    expect([expand.relativePath, expand.expanded]).toEqual(['src', false])
    act(() => { expand.toggle() })
    await act(() => h.script.watches.ready(`${ROOT}/src`))
    await act(() => h.script.settle({ ok: true, value: { entries: [{ name: 'a.ts', type: 'file' }], truncated: false } }))
    expect(row.getAttribute('aria-expanded')).toBe('true')
    // A toggle the tree has since overtaken does nothing.
    act(() => { expand.toggle() })
    expect(row.getAttribute('aria-expanded')).toBe('true')
    // An open directory's menu offers the collapse instead.
    fireEvent.contextMenu(row)
    const collapse = h.rows.get(lastMenu(h.shared.openMenu).target.value)
    if (collapse?.kind !== 'directory') throw new Error('expected the press to record the directory row\'s arms')
    expect(collapse.expanded).toBe(true)
    act(() => { collapse.toggle() })
    expect(row.getAttribute('aria-expanded')).toBe('false')
    expect(h.view.container.querySelector(`[data-files-path="${ROOT}/src/a.ts"]`)).toBeNull()
  })

  it('anchors a row menu at the row when the press names no point', async () => {
    const h = mountBody()
    await act(() => h.script.watches.ready(ROOT))
    await act(() => h.script.settle({ ok: true, value: ROOT_LEVEL }))
    const row = h.view.container.querySelector<HTMLElement>(`[data-files-path="${ROOT}/README.md"] button`)!
    // A keyboard context-menu press carries no pointer, so the row's box stands in.
    Object.defineProperty(row, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ left: 40, right: 400, top: 60, bottom: 84, width: 360, height: 24, x: 40, y: 60, toJSON: () => ({}) }),
    })
    fireEvent.contextMenu(row)
    expect(lastMenu(h.shared.openMenu).point).toEqual({ x: 40, y: 84 })
  })

  it('settles the divider ratio when a drag ends, and ignores a press without movement', async () => {
    const { view, script, instance } = mountBody()
    await act(() => script.watches.ready(ROOT))
    await act(() => script.settle({ ok: true, value: ROOT_LEVEL }))
    const workbench = view.container.querySelector('[data-files-workbench]')!
    // jsdom reports no layout: the drag's arithmetic is its own, so stub the box.
    Object.defineProperty(workbench, 'getBoundingClientRect', {
      value: () => ({ left: 0, width: 1000, top: 0, right: 1000, bottom: 500, height: 500, x: 0, y: 0, toJSON: () => ({}) }),
    })
    const splitter = view.container.querySelector('[data-files-splitter]')!
    splitter.setPointerCapture = () => {}
    splitter.releasePointerCapture = () => {}
    splitter.hasPointerCapture = () => true
    act(() => { fireEvent.pointerDown(splitter, { pointerId: 1, button: 0, clientX: 600 }) })
    act(() => { fireEvent.pointerMove(splitter, { pointerId: 1, clientX: 750 }) })
    act(() => { fireEvent.pointerUp(splitter, { pointerId: 1, clientX: 750 }) })
    expect(instance.getSnapshot().byTab[TAB]?.ratio).toBeCloseTo(0.75, 5)
    // The draggable range clamps at 80% of the workbench.
    act(() => { fireEvent.pointerDown(splitter, { pointerId: 2, button: 0, clientX: 900 }) })
    act(() => { fireEvent.pointerUp(splitter, { pointerId: 2, clientX: 990 }) })
    expect(instance.getSnapshot().byTab[TAB]?.ratio).toBe(0.8)
  })

  it('marks a cut listing and an empty one', async () => {
    const { view, script } = mountBody()
    await act(() => script.watches.ready(ROOT))
    await act(() => script.settle({ ok: true, value: { entries: [{ name: 'd', type: 'directory' }], truncated: true } }))
    expect(view.container.querySelector('[data-files-row="truncated"]')?.textContent).toBe(zh.truncated)
    act(() => { fireEvent.click(within(view.container.querySelector<HTMLElement>(`[data-files-path="${ROOT}/d"]`)!).getByRole('button', { name: 'd' })) })
    await act(() => script.watches.ready(`${ROOT}/d`))
    await act(() => script.settle({ ok: true, value: { entries: [], truncated: false } }))
    expect(view.container.querySelector('[data-files-row="empty"]')?.textContent).toBe(zh.empty)
  })

  it('shows a failed level under its directory in terms of the directory', async () => {
    const { view, script } = mountBody()
    await act(() => script.watches.ready(ROOT))
    await act(() => script.settle({
      ok: false,
      error: new RemoteError('workspace-file/not-found', 'gone', { path: ROOT }),
    }))
    expect(view.container.querySelector('[data-files-row="failed"]')?.textContent).toBe(zh['error.notFound'])
    expect(view.container.querySelector('[data-files-row="empty"]')).toBeNull()
  })

  it('shows a refresh failure beside the existing directory rows and clears it on retry', async () => {
    const { view, script } = mountBody()
    await act(() => script.watches.ready(ROOT))
    await act(() => script.settle({ ok: true, value: ROOT_LEVEL }))
    const rows = names(view.container)
    const reload = view.getByRole('button', { name: zh.reload })
    act(() => { fireEvent.click(reload) })
    await act(() => script.settle({
      ok: false, error: new RemoteError('workspace-file/not-found', 'gone', { path: ROOT }),
    }))
    expect(view.container.querySelector('[data-files-row="failed"]')?.textContent).toBe(zh['error.notFound'])
    expect(names(view.container)).toEqual(rows)
    act(() => { fireEvent.click(reload) })
    await act(() => script.settle({ ok: true, value: ROOT_LEVEL }))
    expect(view.container.querySelector('[data-files-row="failed"]')).toBeNull()
    expect(names(view.container)).toEqual(rows)
  })

  it.each(['button', 'shortcut'])('%s refreshes expanded nodes without clearing cached rows or the scroll position', async (source) => {
    const { view, script, instance, tabActions } = mountBody()
    const child = `${ROOT}/src`
    const collapsed = `${ROOT}/docs`
    const rootStream = await act(() => script.watches.ready(ROOT))
    await act(() => script.settle({ ok: true, value: ROOT_LEVEL }))
    act(() => { fireEvent.click(within(view.container.querySelector<HTMLElement>(`[data-files-path="${child}"]`)!).getByRole('button', { name: 'src' })) })
    await act(() => script.watches.ready(child))
    await act(() => script.settle({ ok: true, value: ROOT_LEVEL }))
    act(() => { instance.actions.loaded(PANE, collapsed, ROOT_LEVEL) })
    const cached = instance.getSnapshot().byPane[PANE]!.tree!
    const childRow = view.container.querySelector(`[data-files-path="${child}"]`)
    const body = view.container.querySelector('[data-files-body]')!
    fireEvent.scroll(body, { target: { scrollTop: 120 } })

    act(() => {
      if (source === 'button') fireEvent.click(view.container.querySelector('[data-files-reload]')!)
      else tabActions.bindCommands.mock.calls.at(-1)![0].refresh!()
    })
    expect(script.list.mock.calls.slice(2).map(call => call[1])).toEqual([ROOT])
    expect(script.list).toHaveBeenLastCalledWith(SESSION, ROOT, rootStream.signal)
    // A level listed again keeps its entries, marked as refreshing.
    expect(instance.getSnapshot().byPane[PANE]!.tree!.levels)
      .toEqual({ ...cached.levels, [ROOT]: { ...cached.levels[ROOT], refreshing: true } })
    expect(view.container.querySelector('[data-files-row="loading"]')).toBeNull()
    await act(async () => {
      await script.settle({ ok: true, value: ROOT_LEVEL })
      await script.waitForList(3)
    })
    expect(script.list.mock.calls.slice(2).map(call => call[1])).toEqual([ROOT, child])
    expect(instance.getSnapshot().byPane[PANE]!.tree!.levels)
      .toEqual({ ...cached.levels, [child]: { ...cached.levels[child], refreshing: true } })
    await act(() => script.settle({ ok: true, value: ROOT_LEVEL }))
    expect(view.container.querySelector(`[data-files-path="${child}"]`)).toBe(childRow)
    expect(body.scrollTop).toBe(120)
    expect(instance.getSnapshot().byPane[PANE]!.tree!.expanded).toEqual([ROOT, child])
    expect(script.watches.opened.map(stream => stream.path)).toEqual([ROOT, child])
    expect(view.container.querySelector('[data-files-reload]')?.getAttribute('aria-label')).toBe(zh.reload)
  })

  it('keeps the automatic control hidden and enabled by default, with manual reload independent of its setting', async () => {
    const { view, script, instance } = mountBody()
    const stream = await act(() => script.watches.ready(ROOT))
    await act(() => script.settle({ ok: true, value: ROOT_LEVEL }))
    const automatic = view.container.querySelector('[data-files-auto-refresh]')!
    expect(automatic.closest('span[hidden]')).not.toBeNull()
    expect(automatic.getAttribute('aria-pressed')).toBe('true')
    expect(view.queryByRole('button', { name: zh.autoRefresh })).toBeNull()
    expect(view.getByRole('button', { name: zh.reload })).toBeDefined()
    act(() => { fireEvent.click(automatic) })
    expect(automatic.getAttribute('aria-pressed')).toBe('false')
    await act(() => stream.deliver('change'))
    expect(script.list).toHaveBeenCalledTimes(1)
    act(() => { fireEvent.click(view.getByRole('button', { name: zh.reload })) })
    await act(() => script.settle({ ok: true, value: ROOT_LEVEL }))
    expect(script.list).toHaveBeenCalledTimes(2)
    expect(instance.getSnapshot().byPane[PANE]!.tree!.autoRefresh).toBe(false)
    expect(automatic.getAttribute('aria-pressed')).toBe('false')
  })

  it('keeps the tree\'s scroll offset in its pane when a tab switch remounts the page', async () => {
    const { view, script, remount } = mountBody()
    await act(() => script.watches.ready(ROOT))
    await act(() => script.settle({ ok: true, value: ROOT_LEVEL }))
    fireEvent.scroll(view.container.querySelector('[data-files-body]')!, { target: { scrollTop: 120 } })
    view.unmount()
    // The tab still owns the pane, so the pane keeps the offset its navigator reported.
    const back = remount()
    expect(back.container.querySelector('[data-files-body]')!.scrollTop).toBe(120)
  })

  it('an aborted record is forgotten and not seeded again while the body is still mounted', async () => {
    const { view, script, controller, instance } = mountBody()
    await act(() => script.watches.ready(ROOT))
    await act(() => script.settle({ ok: true, value: ROOT_LEVEL }))
    act(() => { controller.abort() })
    expect(instance.getSnapshot().byTab[TAB]).toBeUndefined()
    expect(view.container.querySelector('[data-files-state="tree"]')).toBeNull()
    expect(script.list).toHaveBeenCalledTimes(1)
  })

  it('switches to one column below the measured threshold and drills into the preview', async () => {
    class FakeResizeObserver implements ResizeObserver {
      static all: FakeResizeObserver[] = []
      readonly observed: Element[] = []
      readonly observe = vi.fn((element: Element) => { this.observed.push(element) })
      readonly unobserve = vi.fn()
      readonly disconnect = vi.fn()
      constructor(private readonly callback: ResizeObserverCallback) {
        FakeResizeObserver.all.push(this)
      }

      fire(width: number): void {
        this.callback([{ contentRect: { width } } as ResizeObserverEntry], this)
      }
    }
    FakeResizeObserver.all = []
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)
    try {
      const { view, script, instance } = mountBody()
      await act(() => script.watches.ready(ROOT))
      await act(() => script.settle({ ok: true, value: ROOT_LEVEL }))
      const host = view.container.querySelector('[data-files-container-host]')
      if (host === null) throw new Error('expected the measured container host')
      const observer = FakeResizeObserver.all.find(candidate => candidate.observed.includes(host))
      if (observer === undefined) throw new Error('expected the workbench to measure its container')
      act(() => { observer.fire(400) })
      expect(host.getAttribute('data-files-files-layout')).toBe('narrow')
      expect(host.getAttribute('data-files-files-page')).toBe('list')
      expect(view.container.querySelector('[data-files-narrow-pane="tree"]')).not.toBeNull()
      expect(view.container.querySelector('[data-files-preview]')).toBeNull()

      act(() => {
        fireEvent.click(view.container.querySelector(`[data-files-path="${ROOT}/README.md"] button`)!)
      })
      expect(instance.getSnapshot().byTab[TAB]?.pageOpen).toBe(true)
      expect(host.getAttribute('data-files-files-page')).toBe('open')
      expect(view.container.querySelector('[data-files-narrow-pane="preview"]')).not.toBeNull()
      expect(view.container.querySelector('[data-files-preview]')).not.toBeNull()
      expect(view.container.querySelector('[data-files-files-back]')).not.toBeNull()

      act(() => { fireEvent.click(view.container.querySelector('[data-files-files-back]')!) })
      expect(instance.getSnapshot().byTab[TAB]?.pageOpen).toBe(false)
      expect(host.getAttribute('data-files-files-page')).toBe('list')
      expect(view.container.querySelector('[data-files-narrow-pane="tree"]')).not.toBeNull()

      // Widening puts both columns back: the tree returns beside the preview
      // that was drilled into, and the one-column pane is gone.
      act(() => { observer.fire(700) })
      expect(host.getAttribute('data-files-files-layout')).toBe('wide')
      expect(view.container.querySelector('[data-files-splitter]')).not.toBeNull()
      expect(view.container.querySelector('[data-files-preview]')).not.toBeNull()
      expect(view.container.querySelector('[data-files-narrow-pane]')).toBeNull()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('hands focus to the preview and back to the row it came from', async () => {
    const observer = resizeObserver()
    vi.stubGlobal('ResizeObserver', observer.type)
    try {
      const { view, script } = mountBody()
      await act(() => script.watches.ready(ROOT))
      await act(() => script.settle({ ok: true, value: ROOT_LEVEL }))
      const host = view.container.querySelector('[data-files-container-host]')!
      act(() => { observer.for(host).fire(400) })
      const row = view.container.querySelector<HTMLElement>(`[data-files-path="${ROOT}/README.md"] button`)!
      row.focus()
      act(() => { fireEvent.click(row) })
      expect(document.activeElement).toBe(view.container.querySelector('[data-files-files-back]'))
      act(() => { fireEvent.click(view.container.querySelector('[data-files-files-back]')!) })
      expect(document.activeElement).toBe(view.container.querySelector(`[data-files-path="${ROOT}/README.md"] button`))
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('returns focus to the tree when the last chip closed out of the preview', async () => {
    const observer = resizeObserver()
    vi.stubGlobal('ResizeObserver', observer.type)
    try {
      const { view, script } = mountBody()
      await act(() => script.watches.ready(ROOT))
      await act(() => script.settle({ ok: true, value: ROOT_LEVEL }))
      act(() => { observer.for(view.container.querySelector('[data-files-container-host]')!).fire(400) })
      act(() => { fireEvent.click(view.container.querySelector(`[data-files-path="${ROOT}/README.md"] button`)!) })
      // Closing the shown file's own chip leaves the preview with nothing to
      // show, so the store closes the drill-down and the selection with it.
      act(() => { fireEvent.click(view.container.querySelector(`[data-files-tab-close="${ROOT}/README.md"]`)!) })
      expect(view.container.querySelector('[data-files-narrow-pane="tree"]')).not.toBeNull()
      expect(document.activeElement).toBe(view.container.querySelector('[data-files-tree-action="expand"]'))
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('keeps the tree scroll offset across a narrow drill-down round trip', async () => {
    const observer = resizeObserver()
    vi.stubGlobal('ResizeObserver', observer.type)
    try {
      const { view, script } = mountBody()
      await act(() => script.watches.ready(ROOT))
      await act(() => script.settle({ ok: true, value: ROOT_LEVEL }))
      act(() => { observer.for(view.container.querySelector('[data-files-container-host]')!).fire(400) })
      const body = view.container.querySelector<HTMLElement>('[data-files-body]')!
      body.scrollTop = 300
      act(() => { fireEvent.scroll(body) })
      act(() => { fireEvent.click(view.container.querySelector(`[data-files-path="${ROOT}/README.md"] button`)!) })
      act(() => { fireEvent.click(view.container.querySelector('[data-files-files-back]')!) })
      // The drill-down remounts the tree's scroller; the offset it was at
      // before the preview opened comes back with it.
      expect(view.container.querySelector<HTMLElement>('[data-files-body]')!.scrollTop).toBe(300)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('failureLine', () => {
  const t = makeTranslate(zh)

  it('names each directory failure', () => {
    expect(failureLine(t, new RemoteError('workspace-file/not-found', 'x', { path: 'p' }))).toBe(zh['error.notFound'])
    expect(failureLine(t, new RemoteError('workspace-file/outside-workspace', 'x', { path: 'p' })))
      .toBe(zh['error.outsideWorkspace'])
    expect(failureLine(t, new RemoteError('workspace-file/not-directory', 'x', { path: 'p', kind: 'file' })))
      .toBe(zh['error.notDirectory'])
  })

  it('carries an unclassified failure\'s own message', () => {
    const failure = { code: 'remote/transport', message: 'socket closed' } as unknown as RemoteFailure
    expect(failureLine(t, failure)).toBe('读取失败：socket closed')
  })
})
