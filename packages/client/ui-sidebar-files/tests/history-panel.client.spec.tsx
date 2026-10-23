// @vitest-environment jsdom
/** The history view's presentation: the navigator, its refs filter, and the commit page. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { WorkspaceGitCommitDetail, WorkspaceGitRef } from '@deepseek-ai/dsh-workspace-changes/types'
import { CommitPage } from '../src/client/CommitPage.tsx'
import type { CommitPageProps } from '../src/client/CommitPage.tsx'
import { HistoryPanel } from '../src/client/HistoryPanel.tsx'
import type { HistoryPanelProps } from '../src/client/HistoryPanel.tsx'
import { refsByCommit } from '../src/client/history.ts'
import { zh } from '../src/client/locales.ts'
import type { HistoryTabState } from '../src/client/store.ts'
import {
  COMMITS, DETAIL, DIFF, hash, historyState, REFS,
} from './history-fixtures.client.ts'

afterEach(() => { cleanup() })

const t = makeTranslate(zh)
const NOW = Date.parse('2026-10-19T12:00:00+08:00')

/** The gestures the panel reports; each case watches the one it presses. */
function panelHands() {
  return {
    onSelectRef: vi.fn(), onRefresh: vi.fn(), onRetryRefs: vi.fn(), onLoadMore: vi.fn(),
    onRetryList: vi.fn(), onSelectCommit: vi.fn(), onDrillDown: vi.fn(), onDirty: vi.fn(), onSelectFile: vi.fn(),
    onToggleFiles: vi.fn(), onRetryDetail: vi.fn(), onRetryDiff: vi.fn(), onDiffMode: vi.fn(),
    onDiffComplete: vi.fn(), onRatio: vi.fn(), onBack: vi.fn(), onListScrolled: vi.fn(),
    onPageScrolled: vi.fn(),
  }
}

/** Render the whole history view over a scripted slice. */
function mountHistory(
  overrides: Partial<HistoryTabState> = {},
  dirtyCount = 0,
  custom: Partial<HistoryPanelProps> = {},
) {
  const hands = panelHands()
  const props: HistoryPanelProps = { history: historyState(overrides), dirtyCount, ...hands, t, ...custom }
  return { props, hands, ...render(<HistoryPanel {...props} />) }
}

/** Render just the commit page over a scripted slice. */
function mountPage(
  overrides: Partial<HistoryTabState> = {},
  custom: Partial<CommitPageProps> = {},
) {
  const hands = panelHands()
  const tips = refsByCommit(REFS)
  const props: CommitPageProps = {
    history: historyState(overrides), narrow: false, tips, now: NOW,
    onBack: hands.onBack, onSelectFile: hands.onSelectFile, onToggleFiles: hands.onToggleFiles,
    onRetryDetail: hands.onRetryDetail, onRetryDiff: hands.onRetryDiff, onDiffMode: hands.onDiffMode,
    onDiffComplete: hands.onDiffComplete, onScrolled: hands.onPageScrolled, t, ...custom,
  }
  return { props, hands, ...render(<CommitPage {...props} />) }
}

/** A ResizeObserver whose batches the spec fires by hand. */
class FakeResizeObserver {
  static latest: FakeResizeObserver | undefined
  readonly observe = vi.fn()
  readonly disconnect = vi.fn()
  constructor(private readonly callback: ResizeObserverCallback) {
    FakeResizeObserver.latest = this
  }

  fire(width?: number): void {
    this.callback(width === undefined ? [] : [{ contentRect: { width } } as ResizeObserverEntry], this as never)
  }
}

/** Run a callback with the fake observer installed. */
function withResizeObserver(run: () => void): void {
  vi.stubGlobal('ResizeObserver', FakeResizeObserver)
  try { run() } finally { vi.unstubAllGlobals() }
}

describe('HistoryPanel navigator', () => {
  it('leads with the commit page and trails with the navigator in the wide layout', () => {
    const { container } = mountHistory({ commits: COMMITS, selected: hash('a'), detail: DETAIL })
    const panel = container.querySelector('[data-files-history]')!
    expect(panel.getAttribute('data-files-history-layout')).toBe('wide')
    expect(container.querySelector('[data-files-history-title]')?.textContent).toBe(zh['history.title'])
    // The commit page leads and the list trails, with the workbench splitter.
    const content = container.querySelector('[data-files-content-column]')!
    const tree = container.querySelector('[data-files-tree-column]')!
    expect(content.querySelector('[data-files-history-page]')).not.toBeNull()
    expect(tree.querySelector('[data-files-history-list]')).not.toBeNull()
    expect(container.querySelector('[data-files-splitter]')).not.toBeNull()
    expect(container.querySelector('[data-files-history-page-subject]')?.textContent).toBe(COMMITS[0]!.subject)
    // Every commit row carries its hash, subject, short hash, and graph gutter.
    const rows = [...container.querySelectorAll('[data-files-history-commit]')]
    expect(rows.map(row => row.getAttribute('data-files-history-commit'))).toEqual(COMMITS.map(commit => commit.hash))
    expect(rows[0]!.getAttribute('aria-current')).toBe('true')
    expect(rows[1]!.getAttribute('aria-current')).toBeNull()
    expect(rows[0]!.querySelector('[data-files-history-subject]')?.textContent).toBe(COMMITS[0]!.subject)
    expect(rows[0]!.querySelector('[data-files-history-commit-hash]')?.textContent).toBe('aaaaaaa')
    expect(rows[0]!.querySelector('svg')).not.toBeNull()
  })

  it('reports the picked commit and the settled divider share', () => {
    const { container, hands } = mountHistory({ commits: COMMITS })
    fireEvent.click(container.querySelector(`[data-files-history-commit="${hash('b')}"]`)!)
    expect(hands.onSelectCommit).toHaveBeenCalledWith(hash('b'))
    // The wide layout draws the page beside the list, so the pick is not a
    // drill-down and leaves the narrow state alone.
    expect(hands.onDrillDown).not.toHaveBeenCalled()
    const splitter = container.querySelector('[data-files-splitter]')!
    const workbench = splitter.parentElement!
    Object.defineProperty(workbench, 'getBoundingClientRect', {
      value: () => ({ left: 0, width: 1000, top: 0, right: 1000, bottom: 500, height: 500, x: 0, y: 0, toJSON: () => ({}) }),
      configurable: true,
    })
    splitter.setPointerCapture = () => {}
    splitter.releasePointerCapture = () => {}
    splitter.hasPointerCapture = () => true
    act(() => { fireEvent.pointerDown(splitter, { pointerId: 1, button: 0, clientX: 500 }) })
    act(() => { fireEvent.pointerMove(splitter, { pointerId: 1, clientX: 650 }) })
    act(() => { fireEvent.pointerUp(splitter, { pointerId: 1, clientX: 650 }) })
    expect(hands.onRatio).toHaveBeenCalledWith(0.65)
  })

  it('shows the refs a commit row names, the attached branch first, and folds the rest into +n', () => {
    const refs: readonly WorkspaceGitRef[] = [
      ...REFS,
      { name: 'topic', refname: 'refs/heads/topic', kind: 'local', hash: hash('b') },
    ]
    const { container } = mountHistory({ commits: COMMITS, refs, ref: 'dev' })
    const row = container.querySelector(`[data-files-history-commit="${hash('b')}"]`)!
    // Two names and the remainder counted, not listed.
    expect(row.textContent).toContain('origin/main')
    expect(row.textContent).toContain('topic')
    expect(row.textContent).toContain('+1')
    // The attached branch is marked on its own commit.
    const head = container.querySelector(`[data-files-history-commit="${hash('a')}"]`)!
    expect(head.textContent).toContain('dev')
    const chip = container.querySelector('[data-files-history-refs]')!
    expect(chip.textContent).toBe('dev')
  })

  it('draws the commit graph: a straight lane for linear history and a diagonal at a merge', () => {
    const linear = mountHistory({ commits: COMMITS, selected: hash('a') })
    const linearRows = [...linear.container.querySelectorAll('[data-files-history-commit]')]
    expect(linearRows).toHaveLength(COMMITS.length)
    for (const row of linearRows) {
      const svg = row.querySelector('svg')!
      expect(svg.getAttribute('aria-hidden')).toBe('true')
      const lines = [...svg.querySelectorAll('line')]
      expect(lines.length).toBeGreaterThan(0)
      // One lane, so every segment keeps the lane's x from the row's top to its
      // bottom and the history reads as one straight line.
      for (const line of lines) expect(line.getAttribute('x1')).toBe(line.getAttribute('x2'))
      // The commit dot sits on that lane at the row's vertical center.
      const circles = [...svg.querySelectorAll('circle')]
      expect(circles.at(-1)!.getAttribute('cx')).toBe('8')
      expect(circles.at(-1)!.getAttribute('cy')).toBe('22')
    }
    // The shown commit carries the active ring; the other rows do not.
    expect(linearRows[0]!.querySelectorAll('svg circle')).toHaveLength(2)
    expect(linearRows[0]!.querySelector('svg circle')!.getAttribute('r')).toBe('6.5')
    expect(linearRows[1]!.querySelectorAll('svg circle')).toHaveLength(1)
    // One lane needs the gutter's padding on both sides only.
    expect(Number(linearRows[0]!.querySelector('svg')!.getAttribute('width'))).toBe(16)
    cleanup()

    const branchy = [
      { hash: hash('d'), short: 'ddddddd', parents: [hash('e'), hash('f')], author: 'jojo', authoredAt: '2026-10-19T10:00:00+08:00', subject: 'Merge a branch' },
      { hash: hash('e'), short: 'eeeeeee', parents: [hash('f')], author: 'jojo', authoredAt: '2026-10-18T10:00:00+08:00', subject: 'Branch work' },
      { hash: hash('f'), short: 'fffffff', parents: [], author: 'jojo', authoredAt: '2026-10-17T10:00:00+08:00', subject: 'Root' },
    ]
    const merged = mountHistory({ commits: branchy })
    const mergeRows = [...merged.container.querySelectorAll('[data-files-history-commit]')]
    // The merge's second parent opens a lane beside the first: one diagonal
    // leaves the dot (row fraction 0.5) for the lane one step to its right.
    const diagonals = [...mergeRows[0]!.querySelectorAll('svg line')]
      .filter(line => line.getAttribute('x1') !== line.getAttribute('x2'))
    expect(diagonals).toHaveLength(1)
    expect(diagonals[0]!.getAttribute('x1')).toBe('8')
    expect(diagonals[0]!.getAttribute('y1')).toBe('22')
    expect(diagonals[0]!.getAttribute('x2')).toBe('17')
    expect(diagonals[0]!.getAttribute('y2')).toBe('44')
    // Two lanes widen the one gutter the whole navigator shares, so every row's
    // drawing and text take the same width.
    const mergeWidth = Number(mergeRows[0]!.querySelector('svg')!.getAttribute('width'))
    expect(mergeWidth).toBe(25)
    for (const row of mergeRows) expect(row.querySelector('svg')!.getAttribute('width')).toBe(String(mergeWidth))
    expect(merged.container.querySelector<HTMLElement>('[data-files-history]')!.style.getPropertyValue('--files-history-gutter-width'))
      .toBe('25px')
    // The node dot remains on the commit's own lane.
    expect(mergeRows[0]!.querySelectorAll('svg circle')).toHaveLength(1)
    expect(mergeRows[0]!.querySelector('svg circle')!.getAttribute('cx')).toBe('8')
  })

  it('draws each list state: pending refs, failed refs, loading, failed, empty', () => {
    const pending = mountHistory({ refsLoading: true })
    expect(pending.container.querySelector('[data-files-history-state="loading"]')?.textContent).toBe(zh['history.loading'])
    cleanup()
    const refsFailed = mountHistory({ refsFailure: true })
    expect(refsFailed.container.querySelector('[data-files-history-state="refs-failed"]')).not.toBeNull()
    fireEvent.click(refsFailed.container.querySelector('[data-files-history-refs-retry]')!)
    expect(refsFailed.hands.onRetryRefs).toHaveBeenCalledOnce()
    cleanup()
    const loading = mountHistory({ refs: REFS, loading: true })
    expect(loading.container.querySelector('[data-files-history-state="loading"]')).not.toBeNull()
    cleanup()
    const failed = mountHistory({ refs: REFS, failure: true })
    expect(failed.container.querySelector('[data-files-history-state="failed"]')).not.toBeNull()
    fireEvent.click(failed.container.querySelector('[data-files-history-retry]')!)
    expect(failed.hands.onRetryList).toHaveBeenCalledOnce()
    cleanup()
    const empty = mountHistory({ refs: REFS })
    expect(empty.container.querySelector('[data-files-history-state="empty"]')?.textContent).toBe(zh['history.empty'])
  })

  it('keeps the loaded pages when a reload fails and offers the retry', () => {
    const { container, hands } = mountHistory({ refs: REFS, commits: COMMITS, failure: true })
    expect(container.querySelectorAll('[data-files-history-commit]')).toHaveLength(3)
    fireEvent.click(container.querySelector('[data-files-history-retry]')!)
    expect(hands.onRetryList).toHaveBeenCalledOnce()
  })

  it('shows the uncommitted-changes row only while walking all refs, and hands it to the git view', () => {
    const shown = mountHistory({ refs: REFS, commits: COMMITS }, 3)
    const dirty = shown.container.querySelector('[data-files-history-dirty]')!
    expect(dirty.textContent).toContain(zh['history.dirty'])
    expect(dirty.textContent).toContain('3 个文件')
    fireEvent.click(dirty)
    expect(shown.hands.onDirty).toHaveBeenCalledOnce()
    cleanup()
    // Walking one ref hides the working tree's row; so does a clean tree.
    const filtered = mountHistory({ refs: REFS, commits: COMMITS, ref: 'dev' }, 3)
    expect(filtered.container.querySelector('[data-files-history-dirty]')).toBeNull()
    cleanup()
    const clean = mountHistory({ refs: REFS, commits: COMMITS }, 0)
    expect(clean.container.querySelector('[data-files-history-dirty]')).toBeNull()
  })

  it('loads more only while the ref has commits after the loaded pages', () => {
    const { container, hands } = mountHistory({ refs: REFS, commits: COMMITS, hasMore: true })
    const load = container.querySelector<HTMLButtonElement>('[data-files-history-load]')!
    expect(load.textContent).toBe(zh['history.loadMore'])
    fireEvent.click(load)
    expect(hands.onLoadMore).toHaveBeenCalledOnce()
    cleanup()
    // A page already in flight disables the control; no more pages hides it.
    const loading = mountHistory({ refs: REFS, commits: COMMITS, hasMore: true, loading: true })
    expect(loading.container.querySelector<HTMLButtonElement>('[data-files-history-load]')!.disabled).toBe(true)
    cleanup()
    const done = mountHistory({ refs: REFS, commits: COMMITS, hasMore: false })
    expect(done.container.querySelector('[data-files-history-load]')).toBeNull()
  })

  it('refreshes the refs and history from the header control', () => {
    const { container, hands } = mountHistory({ refs: REFS, commits: COMMITS })
    fireEvent.click(container.querySelector('[data-files-history-refresh]')!)
    expect(hands.onRefresh).toHaveBeenCalledOnce()
  })

  it('restores the list offset on mount and reports it on unmount', () => {
    const { container, hands, unmount } = mountHistory({
      refs: REFS, commits: COMMITS, listScrollTop: 120,
    })
    const list = container.querySelector<HTMLElement>('[data-files-history-list]')!
    expect(list.scrollTop).toBe(120)
    list.scrollTop = 240
    fireEvent.scroll(list)
    unmount()
    expect(hands.onListScrolled).toHaveBeenCalledWith(240)
  })
})

describe('HistoryPanel refs filter', () => {
  /** Open the refs popover. */
  function openFilter(container: HTMLElement) {
    fireEvent.click(container.querySelector('[data-files-history-refs]')!)
    return document.querySelector<HTMLElement>('[role="dialog"]')!
  }

  it('groups the refs, filters them by search, and reports the pick', () => {
    const { container, hands } = mountHistory({ refs: REFS, commits: COMMITS })
    const popover = openFilter(container)
    expect(popover.querySelector('[data-files-history-refs-search]')).not.toBeNull()
    expect([...document.querySelectorAll('[data-files-history-ref]')].map(row => row.getAttribute('data-files-history-ref')))
      .toEqual([':all', 'dev', 'release', 'origin/main', 'v1.0.0'])
    // Group headings are localized.
    const text = popover.textContent ?? ''
    for (const key of ['history.refs.all', 'history.refs.local', 'history.refs.remote', 'history.refs.tag'] as const) {
      expect(text).toContain(zh[key])
    }
    // Typing narrows the rows; "all refs" stays reachable.
    const input = popover.querySelector<HTMLInputElement>('[data-files-history-refs-search]')!
    fireEvent.change(input, { target: { value: 'ORI' } })
    expect([...document.querySelectorAll('[data-files-history-ref]')].map(row => row.getAttribute('data-files-history-ref')))
      .toEqual([':all', 'origin/main'])
    // Picking one closes the popover and starts the history it names, by its
    // full ref: a branch and a tag may share the display name it shows.
    fireEvent.click(document.querySelector('[data-files-history-ref="origin/main"]')!)
    expect(hands.onSelectRef).toHaveBeenCalledWith('refs/remotes/origin/main')
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    // Reopening starts from the unfiltered list, and the all-refs row walks HEAD.
    fireEvent.click(container.querySelector('[data-files-history-refs]')!)
    expect([...document.querySelectorAll('[data-files-history-ref]')]).toHaveLength(5)
    fireEvent.click(document.querySelector('[data-files-history-ref=":all"]')!)
    expect(hands.onSelectRef).toHaveBeenLastCalledWith(undefined)
  })

  it('draws the selected ref and its check mark in the filter', () => {
    const { container } = mountHistory({ refs: REFS, ref: 'refs/heads/dev' })
    expect(container.querySelector('[data-files-history-refs]')?.textContent).toBe('dev')
    openFilter(container)
    expect(document.querySelector('[data-files-history-ref="dev"]')?.getAttribute('aria-current')).toBe('true')
    expect(document.querySelector('[data-files-history-ref=":all"]')?.getAttribute('aria-current')).toBeNull()
  })

  it('names the walked ref before the refs answer and after it disappears', () => {
    const pending = mountHistory({ refs: undefined, ref: 'refs/heads/dev' })
    expect(pending.container.querySelector('[data-files-history-refs]')?.textContent).toBe('refs/heads/dev')
    cleanup()
    // A ref the repository no longer reports still names the walked history
    // until the next refs read drops it.
    const stale = mountHistory({ refs: REFS, ref: 'refs/heads/gone' })
    expect(stale.container.querySelector('[data-files-history-refs]')?.textContent).toBe('refs/heads/gone')
  })

  it('states the empty search, the loading refs, and the failed refs with their retry', () => {
    const { container } = mountHistory({ refs: REFS })
    const popover = openFilter(container)
    const input = popover.querySelector<HTMLInputElement>('[data-files-history-refs-search]')!
    fireEvent.change(input, { target: { value: 'nothing' } })
    expect(document.querySelector('[data-files-history-refs-state="empty"]')?.textContent).toBe(zh['history.refs.empty'])
    cleanup()
    const loading = mountHistory({ refsLoading: true })
    fireEvent.click(loading.container.querySelector('[data-files-history-refs]')!)
    expect(document.querySelector('[data-files-history-refs-state="loading"]')?.textContent).toBe(zh['history.refs.loading'])
    cleanup()
    const failed = mountHistory({ refsFailure: true })
    fireEvent.click(failed.container.querySelector('[data-files-history-refs]')!)
    expect(document.querySelector('[data-files-history-refs-state="failed"]')?.textContent).toContain(zh['history.refs.failed'])
    fireEvent.click(document.querySelector('[data-files-history-refs-retry]')!)
    expect(failed.hands.onRetryRefs).toHaveBeenCalledOnce()
  })

  it('states an unread refs list as loading, with no retry yet', () => {
    const { container } = mountHistory({})
    fireEvent.click(container.querySelector('[data-files-history-refs]')!)
    expect(document.querySelector('[data-files-history-refs-state="loading"]')?.textContent)
      .toBe(zh['history.refs.loading'])
    expect(document.querySelector('[data-files-history-refs-retry]')).toBeNull()
  })

  it('walks with no rows present, ignores other keys, and closes from the chip', () => {
    const { container } = mountHistory({})
    const chip = container.querySelector('[data-files-history-refs]')!
    fireEvent.click(chip)
    const input = document.querySelector<HTMLInputElement>('[data-files-history-refs-search]')!
    // No refs are loaded, so the arrow walk has nowhere to go.
    act(() => { fireEvent.keyDown(input, { key: 'ArrowDown' }) })
    expect(document.activeElement).toBe(input)
    // Another key stays with the search box.
    act(() => { fireEvent.keyDown(input, { key: 'Enter' }) })
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    // The chip toggles its own popover closed.
    fireEvent.click(chip)
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  it('walks the rows from the search box and dismisses on Escape or an outside press', () => {
    const { container } = mountHistory({ refs: REFS })
    const popover = openFilter(container)
    const input = popover.querySelector<HTMLInputElement>('[data-files-history-refs-search]')!
    act(() => { fireEvent.keyDown(input, { key: 'ArrowDown' }) })
    expect(document.activeElement?.getAttribute('data-files-history-ref')).toBe(':all')
    act(() => { fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' }) })
    expect(document.activeElement?.getAttribute('data-files-history-ref')).toBe('dev')
    act(() => { fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' }) })
    expect(document.activeElement?.getAttribute('data-files-history-ref')).toBe(':all')
    // Escape closes and returns the keyboard to the chip.
    act(() => { fireEvent.keyDown(document.activeElement!, { key: 'Escape' }) })
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(document.activeElement).toBe(container.querySelector('[data-files-history-refs]'))
    // An outside press dismisses without a pick.
    fireEvent.click(container.querySelector('[data-files-history-refs]')!)
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    fireEvent.pointerDown(document.body)
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    // An upward walk from the search box enters the list at its end.
    fireEvent.click(container.querySelector('[data-files-history-refs]')!)
    const reopened = document.querySelector<HTMLInputElement>('[data-files-history-refs-search]')!
    act(() => { fireEvent.keyDown(reopened, { key: 'ArrowUp' }) })
    expect(document.activeElement?.getAttribute('data-files-history-ref')).toBe('v1.0.0')
    // Home and End jump to the ends of the row list.
    act(() => { fireEvent.keyDown(document.activeElement!, { key: 'Home' }) })
    expect(document.activeElement?.getAttribute('data-files-history-ref')).toBe(':all')
    act(() => { fireEvent.keyDown(document.activeElement!, { key: 'End' }) })
    expect(document.activeElement?.getAttribute('data-files-history-ref')).toBe('v1.0.0')
  })

  it('keeps Tab inside the portalled popover', () => {
    const { container } = mountHistory({ refs: REFS })
    const popover = openFilter(container)
    const input = popover.querySelector<HTMLInputElement>('[data-files-history-refs-search]')!
    // The panel is portalled to the body, so without a trap the next Tab would
    // leave it for the page behind and strand the popover open.
    act(() => { fireEvent.keyDown(input, { key: 'Tab' }) })
    expect(document.activeElement?.getAttribute('data-files-history-ref')).toBe(':all')
    act(() => { fireEvent.keyDown(document.activeElement!, { key: 'Tab' }) })
    expect(document.activeElement?.getAttribute('data-files-history-ref')).toBe('dev')
    // The walk wraps at the last row, back to the search box.
    const last = document.querySelector<HTMLElement>('[data-files-history-ref="v1.0.0"]')!
    act(() => { last.focus() })
    act(() => { fireEvent.keyDown(last, { key: 'Tab' }) })
    expect(document.activeElement).toBe(input)
    // Shift+Tab walks the other way.
    act(() => { fireEvent.keyDown(input, { key: 'Tab', shiftKey: true }) })
    expect(document.activeElement?.getAttribute('data-files-history-ref')).toBe('v1.0.0')
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
  })

  it('forwards a Tab from outside the walk to the end it approaches', () => {
    const { container } = mountHistory({ refs: REFS })
    const popover = openFilter(container)
    const input = popover.querySelector<HTMLInputElement>('[data-files-history-refs-search]')!
    // The search box can lose the keyboard while the popover stays open (the
    // reader pressed on a row and released elsewhere), which leaves no current
    // stop for the arithmetic; forward lands on the first, backward the last.
    act(() => { input.blur() })
    act(() => { fireEvent.keyDown(input, { key: 'Tab' }) })
    expect(document.activeElement).toBe(input)
    act(() => { input.blur() })
    act(() => { fireEvent.keyDown(input, { key: 'Tab', shiftKey: true }) })
    expect(document.activeElement?.getAttribute('data-files-history-ref')).toBe('v1.0.0')
    // From a row that is not the first, the backward walk steps one stop back.
    act(() => { fireEvent.keyDown(document.activeElement!, { key: 'Tab', shiftKey: true }) })
    expect(document.activeElement?.getAttribute('data-files-history-ref')).toBe('origin/main')
  })
})

describe('HistoryPanel clock', () => {
  it('re-dates the rows when its minute timer fires and clears it on unmount', () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-10-19T10:00:00Z'))
      const { container, unmount } = mountHistory({
        refs: REFS,
        commits: [{ ...COMMITS[0]!, authoredAt: '2026-10-19T09:59:40Z' }],
      })
      const time = (): string | undefined =>
        container.querySelector('[data-files-history-commit] [title]')?.textContent ?? undefined
      expect(time()).toBe(zh['history.time.now'])
      act(() => { vi.advanceTimersByTime(60_000) })
      // The tick re-dates the row: a minute has passed since its author date.
      expect(time()).toBe(zh['history.time.minutes'].replace('{n}', '1'))
      unmount()
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('HistoryPanel narrow layout', () => {
  it('keeps the wide layout when no width is measured or no observer exists', () => {
    const { container } = mountHistory({ refs: REFS, commits: COMMITS })
    expect(container.querySelector('[data-files-history]')?.getAttribute('data-files-history-layout')).toBe('wide')
    cleanup()
    withResizeObserver(() => {
      const narrow = mountHistory({ refs: REFS, commits: COMMITS })
      act(() => { FakeResizeObserver.latest!.fire(0) })
      expect(narrow.container.querySelector('[data-files-history]')?.getAttribute('data-files-history-layout')).toBe('wide')
      // A batch without an entry states no width either.
      act(() => { FakeResizeObserver.latest!.fire(undefined) })
      expect(narrow.container.querySelector('[data-files-history]')?.getAttribute('data-files-history-layout')).toBe('wide')
      act(() => { FakeResizeObserver.latest!.fire(700) })
      expect(narrow.container.querySelector('[data-files-history]')?.getAttribute('data-files-history-layout')).toBe('wide')
      // A measured narrow panel drops the splitter and shows the list alone.
      act(() => { FakeResizeObserver.latest!.fire(400) })
      expect(narrow.container.querySelector('[data-files-history]')?.getAttribute('data-files-history-layout')).toBe('narrow')
      expect(narrow.container.querySelector('[data-files-splitter]')).toBeNull()
      expect(narrow.container.querySelector('[data-files-history-list]')).not.toBeNull()
      expect(narrow.container.querySelector('[data-files-history-page]')).toBeNull()
    })
  })

  it('defaults to the wide layout where the platform has no observer', () => {
    vi.stubGlobal('ResizeObserver', undefined)
    try {
      const { container } = mountHistory({ refs: REFS, commits: COMMITS })
      expect(container.querySelector('[data-files-history]')?.getAttribute('data-files-history-layout')).toBe('wide')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it.each([[559, 'narrow'], [560, 'wide'], [561, 'wide']] as const)('treats a %ipx panel as %s', (width, layout) => {
    withResizeObserver(() => {
      const { container } = mountHistory({ refs: REFS, commits: COMMITS })
      act(() => { FakeResizeObserver.latest!.fire(width) })
      expect(container.querySelector('[data-files-history]')?.getAttribute('data-files-history-layout')).toBe(layout)
    })
  })

  it('returns the list to the top when the walked ref changes', () => {
    const { container, rerender, props } = mountHistory({
      refs: REFS, commits: COMMITS, listScrollTop: 120,
    })
    const list = container.querySelector<HTMLElement>('[data-files-history-list]')!
    expect(list.scrollTop).toBe(120)
    rerender(<HistoryPanel {...props} history={{ ...props.history, ref: 'dev' }} />)
    expect(container.querySelector<HTMLElement>('[data-files-history-list]')!.scrollTop).toBe(0)
  })

  it('drills into the selected commit and returns through the back control', () => {
    const { container } = mountHistory({
      refs: REFS, commits: COMMITS, selected: hash('a'), detail: DETAIL, pageOpen: true,
    })
    // Without an observer the panel is wide; the drill-down is a narrow state.
    withResizeObserver(() => {
      cleanup()
      const narrow = mountHistory({
        refs: REFS, commits: COMMITS, selected: hash('a'), detail: DETAIL, pageOpen: true,
      })
      act(() => { FakeResizeObserver.latest!.fire(400) })
      expect(narrow.container.querySelector('[data-files-history-page-open]')?.getAttribute('data-files-history-page-open'))
        .toBe('true')
      const back = narrow.container.querySelector('[data-files-history-back]')!
      expect(back.textContent).toBe(zh['history.page.back'])
      fireEvent.click(back)
      expect(narrow.hands.onBack).toHaveBeenCalledOnce()
      expect(narrow.container.querySelector('[data-files-history-list]')).toBeNull()
      expect(narrow.container.querySelector('[data-files-history-page]')).not.toBeNull()
    })
    expect(container.querySelector('[data-files-history]')).toBeNull()
  })

  it('opens the drill-down only for a pick made in the narrow layout', () => {
    withResizeObserver(() => {
      const narrow = mountHistory({ refs: REFS, commits: COMMITS, selected: hash('a'), detail: DETAIL })
      act(() => { FakeResizeObserver.latest!.fire(400) })
      fireEvent.click(narrow.container.querySelector(`[data-files-history-commit="${hash('b')}"]`)!)
      expect(narrow.hands.onSelectCommit).toHaveBeenCalledWith(hash('b'))
      expect(narrow.hands.onDrillDown).toHaveBeenCalledOnce()
    })
  })

  it('moves focus with the narrow drill-down instead of dropping it on the body', () => {
    withResizeObserver(() => {
      const { container, rerender, props } = mountHistory({
        refs: REFS, commits: COMMITS, selected: hash('a'), detail: DETAIL, pageOpen: false,
      })
      act(() => { FakeResizeObserver.latest!.fire(400) })
      // The reader picks a commit: the row unmounts with the list, so focus
      // moves to the page's back control rather than the page body.
      rerender(<HistoryPanel {...props} history={{ ...props.history, pageOpen: true }} />)
      expect(document.activeElement?.getAttribute('data-files-history-back')).not.toBeNull()
      // Going back remounts the list: focus lands on the row it came from.
      rerender(<HistoryPanel {...props} history={{ ...props.history, pageOpen: false }} />)
      expect(document.activeElement?.getAttribute('data-files-history-commit')).toBe(hash('a'))
      expect(container.querySelector('[data-files-history-list]')).not.toBeNull()
    })
  })

  it('returns focus to the refs chip when the selected row is gone', () => {
    withResizeObserver(() => {
      const { rerender, props } = mountHistory({
        refs: REFS, commits: COMMITS, selected: hash('a'), detail: DETAIL, pageOpen: true,
      })
      act(() => { FakeResizeObserver.latest!.fire(400) })
      // A refresh dropped the selected commit: the back transition has no row
      // to land on, so keyboard focus stays on the navigator's refs control.
      rerender(<HistoryPanel {...props} history={{ ...props.history, commits: [], pageOpen: false }} />)
      expect(document.activeElement?.getAttribute('data-files-history-refs')).not.toBeNull()
    })
  })

  it('returns focus to the refs chip when the state dropped the commit itself', () => {
    withResizeObserver(() => {
      const { rerender, props } = mountHistory({
        refs: REFS, commits: COMMITS, selected: hash('a'), detail: DETAIL, pageOpen: true,
      })
      act(() => { FakeResizeObserver.latest!.fire(400) })
      // A refs settlement restarted the list, which clears the selection with
      // the drill-down: there is no selection left to look a row up by.
      rerender(<HistoryPanel {...props} history={{ ...props.history, selected: undefined, pageOpen: false }} />)
      expect(document.activeElement?.getAttribute('data-files-history-refs')).not.toBeNull()
    })
  })

  it('disconnects its observer with the panel', () => {
    withResizeObserver(() => {
      const { unmount } = mountHistory({ refs: REFS, commits: COMMITS })
      const observer = FakeResizeObserver.latest!
      expect(observer.observe).toHaveBeenCalledOnce()
      unmount()
      expect(observer.disconnect).toHaveBeenCalledOnce()
    })
  })
})

describe('CommitPage', () => {
  it('says nothing is selected, and reads the page while its detail loads', () => {
    const none = mountPage()
    expect(none.container.querySelector('[data-files-history-page-state="none"]')?.textContent)
      .toBe(zh['history.page.none'])
    cleanup()
    // The list already holds the commit's subject, so the page heads it while
    // the detail read is in flight.
    const loading = mountPage({ commits: COMMITS, selected: hash('a'), detail: 'loading' })
    expect(loading.container.querySelector('[data-files-history-page-subject]')?.textContent).toBe(COMMITS[0]!.subject)
    expect(loading.container.querySelector('[data-files-history-page-state="loading"]')?.textContent)
      .toBe(zh['history.page.loading'])
  })

  it('offers the detail retry when the commit page failed', () => {
    const { container, hands } = mountPage({ commits: COMMITS, selected: hash('a'), detail: 'failed' })
    expect(container.querySelector('[data-files-history-page-state="failed"]')).not.toBeNull()
    fireEvent.click(container.querySelector('[data-files-history-detail-retry]')!)
    expect(hands.onRetryDetail).toHaveBeenCalledOnce()
  })

  it('draws the message, ref pills, and changed files of the selected commit', () => {
    const { container, hands } = mountPage({
      commits: COMMITS, selected: hash('a'), detail: DETAIL, refs: REFS,
      file: 'packages/app/src/a.ts', diff: DIFF,
    })
    expect(container.querySelector('[data-files-history-page-subject]')?.textContent).toBe(COMMITS[0]!.subject)
    expect(container.querySelector('[data-files-history-page-hash]')?.textContent).toBe('aaaaaaa')
    const meta = container.querySelector('[data-files-history-page-meta]')!
    expect(meta.textContent).toContain('jojo')
    expect(meta.textContent).toContain('dev')
    // The complete message folds behind its toggle.
    const toggle = container.querySelector<HTMLButtonElement>('[data-files-history-message-toggle]')!
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(container.querySelector('[data-files-history-page-message]')).toBeNull()
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(container.querySelector('[data-files-history-page-message]')?.textContent).toContain('Two columns')
    fireEvent.click(toggle)
    expect(container.querySelector('[data-files-history-page-message]')).toBeNull()
    // The file section states the commit's totals and each file's own counts.
    const summary = container.querySelector('[data-files-history-summary]')!
    expect(summary.textContent).toContain('2 个文件')
    expect(summary.textContent).toContain('+5')
    expect(summary.textContent).toContain('−1')
    const files = [...container.querySelectorAll('[data-files-history-file]')]
    expect(files.map(file => file.getAttribute('data-files-history-file')))
      .toEqual(['packages/app/src/a.ts', 'packages/app/b.md'])
    expect(files[0]!.textContent).toContain('M')
    expect(files[0]!.textContent).toContain('+3')
    expect(files[1]!.textContent).toContain('A')
    expect(files[0]!.getAttribute('aria-current')).toBe('true')
    fireEvent.click(files[1]!)
    expect(hands.onSelectFile).toHaveBeenCalledWith('packages/app/b.md')
    fireEvent.click(summary)
    expect(hands.onToggleFiles).toHaveBeenCalledOnce()
  })

  it('folds the file rows and hands the comparison their height', () => {
    const { container } = mountPage({
      commits: COMMITS, selected: hash('a'), detail: DETAIL, filesOpen: false,
      file: 'packages/app/src/a.ts', diff: DIFF,
    })
    expect(container.querySelector('[data-files-history-summary]')?.getAttribute('aria-expanded')).toBe('false')
    expect(container.querySelectorAll('[data-files-history-file]')).toHaveLength(0)
    // The folded summary names the file the comparison shows.
    expect(container.querySelector('[data-files-history-summary]')?.textContent).toContain('packages/app/src/a.ts')
    expect(container.querySelector('[data-files-history-diff]')).not.toBeNull()
  })

  it('states the omitted files when the host cap cut the list', () => {
    const capped: WorkspaceGitCommitDetail = { ...DETAIL, total: 5 }
    const { container } = mountPage({ commits: COMMITS, selected: hash('a'), detail: capped, file: 'packages/app/src/a.ts', diff: DIFF })
    expect(container.querySelector('[data-files-history-truncated]')?.textContent)
      .toBe('共 5 个文件，只显示前 2 个')
    // The capped rows are not a commit total, so the summary omits the counts.
    const summary = container.querySelector('[data-files-history-summary]')!
    expect(summary.textContent).not.toContain('+5')
    expect(summary.textContent).not.toContain('−1')
  })

  it('draws the comparison in each of its states', () => {
    const states = (overrides: Partial<HistoryTabState>): string | null => {
      const { container } = mountPage({
        commits: COMMITS, selected: hash('a'), detail: DETAIL, file: 'packages/app/src/a.ts', ...overrides,
      })
      const state = container.querySelector('[data-files-history-diff-state]')?.getAttribute('data-files-history-diff-state') ?? null
      cleanup()
      return state
    }
    // The file selection precedes its comparison; both blank states say loading.
    expect(states({ file: undefined, diff: undefined })).toBe('loading')
    expect(states({ diff: undefined })).toBe('loading')
    expect(states({ diff: 'loading' })).toBe('loading')
    expect(states({ diff: 'failed' })).toBe('failed')
    expect(states({ diff: { kind: 'binary', path: 'a.ts', display: 'a.ts' } })).toBe('binary')
    expect(states({ diff: { kind: 'oversized', path: 'a.ts', display: 'a.ts' } })).toBe('oversized')
    expect(states({ diff: { ...DIFF, hunks: [] } })).toBe('empty')
    const drawn = mountPage({
      commits: COMMITS, selected: hash('a'), detail: DETAIL, file: 'packages/app/src/a.ts', diff: DIFF,
    })
    expect(drawn.container.querySelector('[data-files-history-diff]')?.getAttribute('data-files-history-diff'))
      .toBe('packages/app/src/a.ts')
    expect(drawn.container.querySelector('[data-review-view="unified"]')).not.toBeNull()
    expect(drawn.container.querySelector('[data-diff-line]')).not.toBeNull()
  })

  it('states binary and one-sided file counts', () => {
    const detail: WorkspaceGitCommitDetail = {
      ...DETAIL,
      total: 3,
      files: [
        { path: 'bin/a.bin', display: 'bin/a.bin', kind: 'modified', added: 0, deleted: 0, binary: true },
        { path: 'docs/x.md', display: 'docs/x.md', kind: 'modified', added: 0, deleted: 5 },
        { path: 'docs/y.md', display: 'docs/y.md', kind: 'added', added: 4, deleted: 0 },
      ],
    }
    const { container } = mountPage({
      commits: COMMITS, selected: hash('a'), detail, file: 'bin/a.bin', diff: { kind: 'binary', path: 'bin/a.bin', display: 'bin/a.bin' },
    })
    const rows = [...container.querySelectorAll('[data-files-history-file]')]
    expect(rows[0]!.textContent).toContain(zh['history.files.binary'])
    expect(rows[1]!.textContent).toContain('−5')
    expect(rows[1]!.textContent).not.toContain('+')
    expect(rows[2]!.textContent).toContain('+4')
    expect(rows[2]!.textContent).not.toContain('−')
    // The complete count still heads the summary when every file is present.
    expect(container.querySelector('[data-files-history-summary]')?.textContent).toContain('3 个文件')
  })

  it('draws the page before its commit is in the loaded list', () => {
    const { container } = mountPage({ selected: hash('a'), detail: 'loading' })
    expect(container.querySelector('[data-files-history-page-subject]')).toBeNull()
    expect(container.querySelector('[data-files-history-page-state="loading"]')).not.toBeNull()
    expect(container.querySelector('[data-files-history-page-meta]')).toBeNull()
  })

  it('folds only the body past the subject, and folds page pills past four', () => {
    const manyRefs: readonly WorkspaceGitRef[] = [
      { name: 'dev', refname: 'refs/heads/dev', kind: 'local', hash: hash('a'), head: true },
      { name: 'a', refname: 'refs/heads/a', kind: 'local', hash: hash('a') },
      { name: 'b', refname: 'refs/heads/b', kind: 'local', hash: hash('a') },
      { name: 'origin/c', refname: 'refs/remotes/origin/c', kind: 'remote', hash: hash('a') },
      { name: 'v1', refname: 'refs/tags/v1', kind: 'tag', hash: hash('a') },
    ]
    // `%s` folds a wrapped subject onto one line while the stored message keeps
    // the break, so the page must fold the paragraph, not the subject text.
    const { container } = mountPage({
      commits: COMMITS, selected: hash('a'), refs: manyRefs,
      detail: { ...DETAIL, message: 'feat(client): add the\nhistory view\n\nA rewritten body.' },
      file: 'packages/app/src/a.ts', diff: DIFF,
    }, { tips: refsByCommit(manyRefs) })
    const meta = container.querySelector('[data-files-history-page-meta]')!
    expect(meta.textContent).toContain('+1')
    fireEvent.click(container.querySelector('[data-files-history-message-toggle]')!)
    expect(container.querySelector('[data-files-history-page-message]')?.textContent).toBe('A rewritten body.')
    cleanup()
    // A message that is only its subject has nothing to fold.
    const single = mountPage({
      commits: COMMITS, selected: hash('a'), detail: { ...DETAIL, message: 'feat(client): add the history view' },
      file: 'packages/app/src/a.ts', diff: DIFF,
    })
    expect(single.container.querySelector('[data-files-history-message-toggle]')).toBeNull()
  })

  it('retries a failed comparison and switches its layout', () => {
    const { container, hands } = mountPage({
      commits: COMMITS, selected: hash('a'), detail: DETAIL, file: 'packages/app/src/a.ts', diff: 'failed',
    })
    fireEvent.click(container.querySelector('[data-files-history-diff-retry]')!)
    expect(hands.onRetryDiff).toHaveBeenCalledOnce()
    cleanup()
    const unified = mountPage({
      commits: COMMITS, selected: hash('a'), detail: DETAIL, file: 'packages/app/src/a.ts', diff: DIFF,
    })
    fireEvent.click(unified.container.querySelector('[data-files-history-diff-mode="unified"]')!)
    expect(unified.hands.onDiffMode).toHaveBeenCalledWith('split')
    cleanup()
    const split = mountPage({
      commits: COMMITS, selected: hash('a'), detail: DETAIL, file: 'packages/app/src/a.ts', diff: DIFF,
      diffMode: 'split',
    })
    expect(split.container.querySelector('[data-review-view="split"]')).not.toBeNull()
    expect(split.container.querySelector('[data-files-history-diff-mode="split"]')?.getAttribute('aria-pressed')).toBe('true')
  })

  it('defaults to the changed hunks and names the scope its press switches to', () => {
    vi.useFakeTimers()
    try {
      const changes = mountPage({
        commits: COMMITS, selected: hash('a'), detail: DETAIL, file: 'packages/app/src/a.ts', diff: DIFF,
      })
      const toggle = changes.container.querySelector<HTMLButtonElement>('[data-files-history-diff-scope]')!
      expect(toggle.getAttribute('data-files-history-diff-scope')).toBe('changes')
      expect(toggle.getAttribute('aria-pressed')).toBe('false')
      expect(toggle.getAttribute('aria-label')).toBe(zh['diff.scope.aria'])
      fireEvent.mouseEnter(toggle)
      act(() => { vi.advanceTimersByTime(300) })
      expect(changes.container.querySelector('[role="tooltip"]')?.textContent).toBe(zh['diff.scope.full'])
      fireEvent.click(toggle)
      expect(changes.hands.onDiffComplete).toHaveBeenCalledWith(true)
      const changesGlyph = toggle.querySelector('svg')?.innerHTML
      cleanup()
      const whole = mountPage({
        commits: COMMITS, selected: hash('a'), detail: DETAIL, file: 'packages/app/src/a.ts', diff: DIFF,
        diffComplete: true,
      })
      const other = whole.container.querySelector<HTMLButtonElement>('[data-files-history-diff-scope]')!
      expect(other.getAttribute('data-files-history-diff-scope')).toBe('complete')
      expect(other.getAttribute('aria-pressed')).toBe('true')
      expect(other.querySelector('svg')?.innerHTML).not.toBe(changesGlyph)
      fireEvent.mouseEnter(other)
      act(() => { vi.advanceTimersByTime(300) })
      expect(whole.container.querySelector('[role="tooltip"]')?.textContent).toBe(zh['diff.scope.changes'])
      fireEvent.click(other)
      expect(whole.hands.onDiffComplete).toHaveBeenLastCalledWith(false)
      // The scope control leads the layout control in the comparison header.
      expect(other.compareDocumentPosition(whole.container.querySelector('[data-files-history-diff-mode]')!)
        & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    } finally {
      vi.useRealTimers()
    }
  })

  it('states a commit that changed no files, and a created file in its comparison', () => {
    const empty = mountPage({
      commits: COMMITS, selected: hash('a'), detail: { ...DETAIL, files: [], total: 0 },
    })
    expect(empty.container.querySelector('[data-files-history-files-empty]')?.textContent).toBe(zh['history.files.empty'])
    cleanup()
    const created = mountPage({
      commits: COMMITS, selected: hash('a'), detail: DETAIL, file: 'packages/app/src/a.ts',
      diff: { ...DIFF, before: false, hunks: [{ ...DIFF.hunks[0]!, lines: ['+only'] }] },
    })
    expect(created.container.querySelector('[data-diff-note="metadata"]')?.textContent).toBe(zh['git.diff.created'])
  })

  it('restores the page offset and reports it for the commit it draws', () => {
    const { container, hands, unmount } = mountPage({
      commits: COMMITS, selected: hash('a'), detail: DETAIL, file: 'packages/app/src/a.ts', diff: DIFF,
      pageScrollTop: 80,
    })
    const page = container.querySelector<HTMLElement>('[data-files-history-page]')!
    expect(page.scrollTop).toBe(80)
    page.scrollTop = 200
    fireEvent.scroll(page)
    unmount()
    expect(hands.onPageScrolled).toHaveBeenCalledWith(hash('a'), 200)
    cleanup()
    // A page that belongs to another commit reports nothing on unmount.
    const none = mountPage({ commits: COMMITS })
    none.unmount()
    expect(none.hands.onPageScrolled).not.toHaveBeenCalled()
  })

  it('draws the back control only in the narrow layout', () => {
    const { container, hands } = mountPage({ commits: COMMITS, selected: hash('a'), detail: DETAIL }, { narrow: true })
    fireEvent.click(container.querySelector('[data-files-history-back]')!)
    expect(hands.onBack).toHaveBeenCalledOnce()
    cleanup()
    const wide = mountPage({ commits: COMMITS, selected: hash('a'), detail: DETAIL })
    expect(wide.container.querySelector('[data-files-history-back]')).toBeNull()
  })
})
