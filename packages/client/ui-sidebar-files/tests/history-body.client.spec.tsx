// @vitest-environment jsdom
/** The history view through the workbench body: seeding, gestures, and the rail. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent } from '@testing-library/react'
import type {
  WorkspaceFileDiff, WorkspaceGitCommit, WorkspaceGitCommitDetail, WorkspaceGitHistory,
} from '@deepseek-ai/dsh-workspace-changes/types'
import type { GitRead } from '../src/client/face.ts'
import { zh } from '../src/client/locales.ts'
import { ROOT, TAB, mountBody } from './mount.client.tsx'
import {
  COMMITS, DETAIL, DIFF, hash, PAGE, REFS,
} from './history-fixtures.client.ts'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

/** The working tree state that offers the rail's git and history containers. */
const REPOSITORY = {
  kind: 'repository' as const,
  branch: 'dev',
  total: 2,
  entries: [
    { path: 'src/a.ts', display: 'src/a.ts', kind: 'modified' as const },
    { path: 'new.ts', display: 'new.ts', kind: 'added' as const },
  ],
}

/** Mount the body with the tree listed and a history answer scripted. */
async function seeded(history: Parameters<typeof mountBody>[4]) {
  const mounted = mountBody(ROOT, undefined, { status: REPOSITORY }, undefined, history)
  await act(() => mounted.script.watches.ready(ROOT))
  await act(() => mounted.script.settle({ ok: true, value: { entries: [], truncated: false } }))
  return mounted
}

/**
 * Flush the list → commit → file read chain the history view starts.
 *
 * One macrotask turn drains every queued microtask, so the whole chain lands
 * regardless of how many awaits it holds today. Under a fake clock the same
 * turn is advanced explicitly, so the timer case shares this helper instead of
 * copying its flush.
 */
async function settleReads(): Promise<void> {
  await act(async () => {
    if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(0)
    else await new Promise((resolve) => { setTimeout(resolve, 0) })
  })
}

/** Select the history container. */
async function openHistory(mounted: Awaited<ReturnType<typeof seeded>>): Promise<void> {
  fireEvent.click(mounted.view.container.querySelector('[data-files-rail-item="history"]')!)
  await settleReads()
}

/** A ResizeObserver whose batches the spec fires by hand. */
class FakeResizeObserver {
  static all: FakeResizeObserver[] = []
  readonly observed: Element[] = []
  readonly observe = vi.fn((element: Element) => { this.observed.push(element) })
  readonly disconnect = vi.fn()
  constructor(private readonly callback: ResizeObserverCallback) {
    FakeResizeObserver.all.push(this)
  }

  /** The observer measuring one element, as several observers share the page. */
  static for(element: Element): FakeResizeObserver | undefined {
    return FakeResizeObserver.all.find(observer => observer.observed.includes(element))
  }

  fire(width: number): void {
    this.callback([{ contentRect: { width } } as ResizeObserverEntry], this as never)
  }
}

describe('history through the body', () => {
  it('seeds the refs, the history, the first commit page, and its first file comparison', async () => {
    const mounted = await seeded({ refs: REFS, history: PAGE, commit: DETAIL, commitDiff: DIFF })
    await openHistory(mounted)
    expect(mounted.instance.getSnapshot().byTab[TAB]?.container).toBe('history')
    expect(mounted.historyRefs).toHaveBeenCalledOnce()
    expect(mounted.history).toHaveBeenCalledOnce()
    expect(mounted.history.mock.calls[0]!.slice(0, 3)).toEqual([TAB, ROOT, { skip: 0, limit: 50 }])
    // The first commit of the page opens with its first changed file.
    expect(mounted.commit).toHaveBeenCalledWith(TAB, ROOT, hash('a'), expect.anything())
    expect(mounted.commitDiff).toHaveBeenCalledWith(
      TAB, ROOT, { hash: hash('a'), path: 'packages/app/src/a.ts' }, expect.anything(),
    )
    const history = mounted.instance.getSnapshot().byTab[TAB]!.history
    expect(history.refs).toEqual(REFS)
    expect(history.commits).toEqual(COMMITS)
    expect(history.selected).toBe(hash('a'))
    expect(history.file).toBe('packages/app/src/a.ts')
    expect(history.detail).toEqual(DETAIL)
    expect(history.diff).toEqual(DIFF)
    // The drawn view: rows, the commit page, its files, and the comparison.
    const view = mounted.view.container
    expect(view.querySelectorAll('[data-files-history-commit]')).toHaveLength(3)
    expect(view.querySelector('[data-files-history-page-subject]')?.textContent).toBe(COMMITS[0]!.subject)
    expect(view.querySelectorAll('[data-files-history-file]')).toHaveLength(2)
    expect(view.querySelector('[data-files-history-diff]')).not.toBeNull()
    expect(view.querySelector('[data-review-view="unified"]')).not.toBeNull()
    // The uncommitted-changes row names the working tree's change count.
    expect(view.querySelector('[data-files-history-dirty]')?.textContent).toContain('2 个文件')
  })

  it('picks a commit, then its file, and switches the comparison layout', async () => {
    const mounted = await seeded({ refs: REFS, history: PAGE, commit: DETAIL, commitDiff: DIFF })
    await openHistory(mounted)
    const second = { ...DETAIL, commit: COMMITS[1]!, files: [DETAIL.files[0]!] }
    mounted.commit.mockResolvedValue({ value: second, current: true })
    fireEvent.click(mounted.view.container.querySelector(`[data-files-history-commit="${hash('b')}"]`)!)
    await settleReads()
    expect(mounted.instance.getSnapshot().byTab[TAB]?.history.selected).toBe(hash('b'))
    expect(mounted.instance.getSnapshot().byTab[TAB]?.history.detail).toEqual(second)
    // The new page's first file is compared with its own commit.
    expect(mounted.commitDiff).toHaveBeenLastCalledWith(
      TAB, ROOT, { hash: hash('b'), path: 'packages/app/src/a.ts' }, expect.anything(),
    )
    await act(async () => {
      fireEvent.click(mounted.view.container.querySelector('[data-files-history-diff-mode="unified"]')!)
    })
    expect(mounted.instance.getSnapshot().byTab[TAB]?.history.diffMode).toBe('split')
    expect(mounted.view.container.querySelector('[data-review-view="split"]')).not.toBeNull()
  })

  it('restarts the list when a ref is picked from the filter', async () => {
    const mounted = await seeded({ refs: REFS, history: PAGE, commit: DETAIL, commitDiff: DIFF })
    await openHistory(mounted)
    const filtered: WorkspaceGitHistory = { commits: [COMMITS[0]!], hasMore: false }
    mounted.history.mockResolvedValueOnce({ value: filtered, current: true })
    fireEvent.click(mounted.view.container.querySelector('[data-files-history-refs]')!)
    fireEvent.click(document.querySelector('[data-files-history-ref="dev"]')!)
    await settleReads()
    expect(mounted.history).toHaveBeenLastCalledWith(
      TAB, ROOT, { ref: 'refs/heads/dev', skip: 0, limit: 50 }, expect.anything(),
    )
    const history = mounted.instance.getSnapshot().byTab[TAB]!.history
    expect(history.ref).toBe('refs/heads/dev')
    expect(history.commits).toEqual(filtered.commits)
    // The replaced list keeps the commit page it already had.
    expect(history.selected).toBe(hash('a'))
    expect(mounted.view.container.querySelector('[data-files-history-refs]')?.textContent).toBe('dev')
  })

  it('appends the next page by the commits already loaded', async () => {
    const mounted = await seeded({ refs: REFS, history: PAGE, commit: DETAIL, commitDiff: DIFF })
    await openHistory(mounted)
    const older = { ...COMMITS[2]!, hash: hash('d'), short: 'ddddddd', parents: [] }
    const next: WorkspaceGitHistory = { commits: [older], hasMore: false }
    mounted.history.mockResolvedValueOnce({ value: next, current: true })
    fireEvent.click(mounted.view.container.querySelector('[data-files-history-load]')!)
    await settleReads()
    expect(mounted.history).toHaveBeenLastCalledWith(
      TAB, ROOT, { skip: 3, limit: 50 }, expect.anything(),
    )
    expect(mounted.instance.getSnapshot().byTab[TAB]?.history.commits).toHaveLength(4)
    expect(mounted.view.container.querySelectorAll('[data-files-history-commit]')).toHaveLength(4)
  })

  it('appends a page that overlaps the loaded one without drawing a row twice', async () => {
    const mounted = await seeded({ refs: REFS, history: PAGE, commit: DETAIL, commitDiff: DIFF })
    await openHistory(mounted)
    const older: WorkspaceGitCommit = {
      hash: hash('d'), short: 'ddddddd', parents: [], author: 'lead',
      authoredAt: '2026-10-16T08:00:00+08:00', subject: 'release: 0.9',
    }
    // The walked ref moved between pages: the next page starts at the offset the
    // list holds but serves its last loaded commit again.
    mounted.history.mockResolvedValueOnce({
      value: { commits: [COMMITS[2]!, older], hasMore: false }, current: true,
    })
    fireEvent.click(mounted.view.container.querySelector('[data-files-history-load]')!)
    await settleReads()
    const drawn = [...mounted.view.container.querySelectorAll('[data-files-history-commit]')]
      .map(row => row.getAttribute('data-files-history-commit'))
    expect(drawn).toEqual([...COMMITS.map(commit => commit.hash), older.hash])
    expect(new Set(drawn).size).toBe(drawn.length)
  })

  it('reads the picked ref when the refs read settles after the pick', async () => {
    const mounted = await seeded({ refs: REFS, history: PAGE, commit: DETAIL, commitDiff: DIFF })
    await openHistory(mounted)
    // A reload starts the refs read; the reader picks a ref before it answers,
    // and the pick starts its own page read.
    let release!: (answer: GitRead<readonly (typeof REFS)[number][]>) => void
    mounted.historyRefs.mockImplementationOnce(() => new Promise((resolve) => { release = resolve }))
    fireEvent.click(mounted.view.container.querySelector('[data-files-history-refresh]')!)
    await act(async () => {})
    mounted.history.mockResolvedValueOnce({ value: PAGE, current: true })
    fireEvent.click(mounted.view.container.querySelector('[data-files-history-refs]')!)
    fireEvent.click(document.querySelector('[data-files-history-ref="dev"]')!)
    await settleReads()
    expect(mounted.instance.getSnapshot().byTab[TAB]?.history.ref).toBe('refs/heads/dev')
    // The settlement reads the picked ref rather than the one the reload began
    // with, so the list never falls back to the ref the reader left.
    await act(async () => { release({ value: REFS, current: true }) })
    await settleReads()
    expect(mounted.instance.getSnapshot().byTab[TAB]?.history.ref).toBe('refs/heads/dev')
    expect(mounted.history).toHaveBeenLastCalledWith(
      TAB, ROOT, { ref: 'refs/heads/dev', skip: 0, limit: 50 }, expect.anything(),
    )
    expect(mounted.history.mock.calls.every(call => call[2].ref === 'refs/heads/dev' || call[2].ref === undefined))
      .toBe(true)
  })

  it('refreshes the refs, the page, and the shown commit from the header', async () => {
    const mounted = await seeded({ refs: REFS, history: PAGE, commit: DETAIL, commitDiff: DIFF })
    await openHistory(mounted)
    // Walk one local branch first, so the refresh has a ref to fall back from.
    mounted.history.mockResolvedValueOnce({ value: PAGE, current: true })
    fireEvent.click(mounted.view.container.querySelector('[data-files-history-refs]')!)
    fireEvent.click(document.querySelector('[data-files-history-ref="dev"]')!)
    await settleReads()
    expect(mounted.instance.getSnapshot().byTab[TAB]?.history.ref).toBe('refs/heads/dev')
    // A reload whose refs no longer report the walked ref falls back to HEAD.
    mounted.historyRefs.mockResolvedValueOnce({ value: [REFS[1]!], current: true })
    fireEvent.click(mounted.view.container.querySelector('[data-files-history-refresh]')!)
    await settleReads()
    expect(mounted.historyRefs).toHaveBeenCalledTimes(2)
    expect(mounted.instance.getSnapshot().byTab[TAB]?.history.ref).toBeUndefined()
    expect(mounted.history).toHaveBeenLastCalledWith(TAB, ROOT, { skip: 0, limit: 50 }, expect.anything())
    // The shown commit page and its comparison are read again with the list.
    expect(mounted.commit.mock.calls.length).toBeGreaterThanOrEqual(2)
    expect(mounted.commitDiff.mock.calls.length).toBeGreaterThanOrEqual(2)
  })

  it('retries a failed comparison from its note', async () => {
    const mounted = await seeded({ refs: REFS, history: PAGE, commit: DETAIL })
    await openHistory(mounted)
    expect(mounted.instance.getSnapshot().byTab[TAB]?.history.diff).toBe('failed')
    mounted.commitDiff.mockResolvedValueOnce({ value: DIFF, current: true })
    fireEvent.click(mounted.view.container.querySelector('[data-files-history-diff-retry]')!)
    await settleReads()
    expect(mounted.commitDiff).toHaveBeenCalledTimes(2)
    expect(mounted.instance.getSnapshot().byTab[TAB]?.history.diff).toEqual(DIFF)
  })

  it('shows the commit page failure and retries it', async () => {
    const mounted = await seeded({ refs: REFS, history: PAGE })
    await openHistory(mounted)
    // The default commit read refuses: the page states the failure.
    expect(mounted.instance.getSnapshot().byTab[TAB]?.history.detail).toBe('failed')
    expect(mounted.view.container.querySelector('[data-files-history-page-state="failed"]')).not.toBeNull()
    mounted.commit.mockResolvedValueOnce({ value: DETAIL, current: true })
    fireEvent.click(mounted.view.container.querySelector('[data-files-history-detail-retry]')!)
    await settleReads()
    expect(mounted.commit).toHaveBeenCalledTimes(2)
    expect(mounted.instance.getSnapshot().byTab[TAB]?.history.detail).toEqual(DETAIL)
  })

  it('hands the uncommitted-changes row to the existing git container', async () => {
    const mounted = await seeded({ refs: REFS, history: PAGE, commit: DETAIL, commitDiff: DIFF })
    await openHistory(mounted)
    fireEvent.click(mounted.view.container.querySelector('[data-files-history-dirty]')!)
    await act(async () => {})
    expect(mounted.instance.getSnapshot().byTab[TAB]?.container).toBe('git')
    expect(mounted.view.container.querySelector('[data-files-git-panel]')).not.toBeNull()
    expect(mounted.view.container.querySelector('[data-files-history]')).toBeNull()
  })

  it('drills into the commit page in the narrow layout and back to the list', async () => {
    FakeResizeObserver.all = []
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)
    try {
      const mounted = await seeded({ refs: REFS, history: PAGE, commit: DETAIL, commitDiff: DIFF })
      await openHistory(mounted)
      const panel = mounted.view.container.querySelector('[data-files-history]')!
      expect(panel.getAttribute('data-files-history-layout')).toBe('wide')
      act(() => { FakeResizeObserver.for(panel)!.fire(400) })
      expect(panel.getAttribute('data-files-history-layout')).toBe('narrow')
      // The narrow list stands alone until a commit row is picked.
      expect(mounted.view.container.querySelector('[data-files-history-page]')).toBeNull()
      expect(mounted.view.container.querySelector('[data-files-history-list]')).not.toBeNull()
      fireEvent.click(mounted.view.container.querySelector(`[data-files-history-commit="${hash('b')}"]`)!)
      await act(async () => {})
      expect(mounted.instance.getSnapshot().byTab[TAB]?.history.pageOpen).toBe(true)
      const page = mounted.view.container.querySelector('[data-files-history-page]')!
      expect(page).not.toBeNull()
      expect(mounted.view.container.querySelector('[data-files-history-list]')).toBeNull()
      fireEvent.click(mounted.view.container.querySelector('[data-files-history-back]')!)
      await act(async () => {})
      expect(mounted.instance.getSnapshot().byTab[TAB]?.history.pageOpen).toBe(false)
      expect(mounted.view.container.querySelector('[data-files-history-list]')).not.toBeNull()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('keeps the history container reachable when git is unavailable', async () => {
    const mounted = mountBody(ROOT, undefined, { status: { kind: 'unavailable', entries: [], total: 0 } }, undefined, {
      refs: REFS, history: PAGE, commit: DETAIL, commitDiff: DIFF,
    })
    await act(() => mounted.script.watches.ready(ROOT))
    await act(() => mounted.script.settle({ ok: true, value: { entries: [], truncated: false } }))
    expect(mounted.view.container.querySelector('[data-files-rail-item="history"]')).not.toBeNull()
    await openHistory(mounted)
    expect(mounted.view.container.querySelector('[data-files-history-list]')).not.toBeNull()
  })

  it('reads nothing on a timer: history is gesture-driven', async () => {
    vi.useFakeTimers()
    try {
      const mounted = mountBody(ROOT, undefined, { status: REPOSITORY }, undefined, {
        refs: REFS, history: PAGE, commit: DETAIL, commitDiff: DIFF,
      })
      await act(() => mounted.script.watches.ready(ROOT))
      await act(() => mounted.script.settle({ ok: true, value: { entries: [], truncated: false } }))
      fireEvent.click(mounted.view.container.querySelector('[data-files-rail-item="history"]')!)
      await settleReads()
      const counts = {
        refs: mounted.historyRefs.mock.calls.length,
        list: mounted.history.mock.calls.length,
        commit: mounted.commit.mock.calls.length,
        diff: mounted.commitDiff.mock.calls.length,
        status: mounted.gitStatus.mock.calls.length,
      }
      await act(async () => { await vi.advanceTimersByTimeAsync(9_000) })
      expect({
        refs: mounted.historyRefs.mock.calls.length,
        list: mounted.history.mock.calls.length,
        commit: mounted.commit.mock.calls.length,
        diff: mounted.commitDiff.mock.calls.length,
        status: mounted.gitStatus.mock.calls.length,
      }).toEqual(counts)
      // Selecting the git container resumes its quiet working-tree polling.
      fireEvent.click(mounted.view.container.querySelector('[data-files-rail-item="git"]')!)
      const before = mounted.gitStatus.mock.calls.length
      await act(async () => { await vi.advanceTimersByTimeAsync(3_000) })
      expect(mounted.gitStatus.mock.calls.length).toBe(before + 1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps the commit list offset across a container switch', async () => {
    const mounted = await seeded({ refs: REFS, history: PAGE, commit: DETAIL, commitDiff: DIFF })
    await openHistory(mounted)
    const list = mounted.view.container.querySelector<HTMLElement>('[data-files-history-list]')!
    list.scrollTop = 140
    fireEvent.scroll(list)
    fireEvent.click(mounted.view.container.querySelector('[data-files-rail-item="files"]')!)
    expect(mounted.instance.getSnapshot().byTab[TAB]?.history.listScrollTop).toBe(140)
    fireEvent.click(mounted.view.container.querySelector('[data-files-rail-item="history"]')!)
    expect(mounted.view.container.querySelector<HTMLElement>('[data-files-history-list]')?.scrollTop).toBe(140)
  })

  it('drops a read that settles after the tab record ended', async () => {
    const mounted = await seeded({ refs: REFS, history: PAGE, commit: DETAIL, commitDiff: DIFF })
    await openHistory(mounted)
    mounted.controller.abort()
    await act(async () => {})
    expect(mounted.instance.getSnapshot().byTab[TAB]).toBeUndefined()
  })

  it('retries the refs read from the list state and the list read from its banner', async () => {
    // The refs read refuses: the rail's history container states it and offers
    // the retry, which reads the refs again.
    const refsFailed = mountBody(ROOT, undefined, { status: REPOSITORY })
    await act(() => refsFailed.script.watches.ready(ROOT))
    await act(() => refsFailed.script.settle({ ok: true, value: { entries: [], truncated: false } }))
    fireEvent.click(refsFailed.view.container.querySelector('[data-files-rail-item="history"]')!)
    await settleReads()
    expect(refsFailed.view.container.querySelector('[data-files-history-state="refs-failed"]')).not.toBeNull()
    fireEvent.click(refsFailed.view.container.querySelector('[data-files-history-refs-retry]')!)
    await settleReads()
    expect(refsFailed.historyRefs).toHaveBeenCalledTimes(2)
    cleanup()
    // The refs read lands but the page read refuses: the list keeps its retry.
    const listFailed = await seeded({ refs: REFS })
    await openHistory(listFailed)
    expect(listFailed.view.container.querySelector('[data-files-history-state="failed"]')).not.toBeNull()
    fireEvent.click(listFailed.view.container.querySelector('[data-files-history-retry]')!)
    await settleReads()
    expect(listFailed.history).toHaveBeenCalledTimes(2)
  })

  it('refreshes an empty page and a commit with no changed files', async () => {
    // No commits in the walked ref: nothing to select, so a refresh reads the
    // refs and the empty page again and asks for no commit.
    const emptyPage = await seeded({ refs: REFS, history: { commits: [], hasMore: false } })
    await openHistory(emptyPage)
    fireEvent.click(emptyPage.view.container.querySelector('[data-files-history-refresh]')!)
    await settleReads()
    expect(emptyPage.historyRefs).toHaveBeenCalledTimes(2)
    expect(emptyPage.history).toHaveBeenCalledTimes(2)
    expect(emptyPage.commit).not.toHaveBeenCalled()
    cleanup()
    // A commit that changed no files leaves the comparison unread.
    const fileless = await seeded({
      refs: REFS, history: PAGE, commit: { ...DETAIL, files: [], total: 0 },
    })
    await openHistory(fileless)
    expect(fileless.instance.getSnapshot().byTab[TAB]?.history.detail).toEqual({ ...DETAIL, files: [], total: 0 })
    expect(fileless.view.container.querySelector('[data-files-history-files-empty]')).not.toBeNull()
    fireEvent.click(fileless.view.container.querySelector('[data-files-history-refresh]')!)
    await settleReads()
    expect(fileless.commit).toHaveBeenCalledTimes(2)
    expect(fileless.commitDiff).not.toHaveBeenCalled()
  })

  it('echoes a rename origin and keeps it across a refresh', async () => {
    const renamed: WorkspaceGitCommitDetail = {
      ...DETAIL,
      files: [{ ...DETAIL.files[0]!, kind: 'renamed', from: 'packages/app/old.ts' }],
      total: 1,
    }
    const mounted = await seeded({
      refs: REFS, history: PAGE, commit: renamed, commitDiff: { ...DIFF, before: true },
    })
    await openHistory(mounted)
    expect(mounted.commitDiff).toHaveBeenCalledWith(
      TAB, ROOT, { hash: hash('a'), path: 'packages/app/src/a.ts', from: 'packages/app/old.ts' }, expect.anything(),
    )
    // A refresh re-reads the shown file with the same origin.
    fireEvent.click(mounted.view.container.querySelector('[data-files-history-refresh]')!)
    await settleReads()
    expect(mounted.commitDiff).toHaveBeenLastCalledWith(
      TAB, ROOT, { hash: hash('a'), path: 'packages/app/src/a.ts', from: 'packages/app/old.ts' }, expect.anything(),
    )
  })

  it('picks another file in the shown commit and toggles its file section', async () => {
    const mounted = await seeded({ refs: REFS, history: PAGE, commit: DETAIL, commitDiff: DIFF })
    await openHistory(mounted)
    fireEvent.click(mounted.view.container.querySelector('[data-files-history-file="packages/app/b.md"]')!)
    await settleReads()
    expect(mounted.instance.getSnapshot().byTab[TAB]?.history.file).toBe('packages/app/b.md')
    expect(mounted.commitDiff).toHaveBeenLastCalledWith(
      TAB, ROOT, { hash: hash('a'), path: 'packages/app/b.md' }, expect.anything(),
    )
    // Folding the file list writes the store's fold, and the summary reopens it.
    fireEvent.click(mounted.view.container.querySelector('[data-files-history-summary]')!)
    expect(mounted.instance.getSnapshot().byTab[TAB]?.history.filesOpen).toBe(false)
    fireEvent.click(mounted.view.container.querySelector('[data-files-history-summary]')!)
    expect(mounted.instance.getSnapshot().byTab[TAB]?.history.filesOpen).toBe(true)
  })

  it('keeps a settled commit page when its row is picked again', async () => {
    const mounted = await seeded({ refs: REFS, history: PAGE, commit: DETAIL, commitDiff: DIFF })
    await openHistory(mounted)
    expect(mounted.commit).toHaveBeenCalledTimes(1)
    fireEvent.click(mounted.view.container.querySelector(`[data-files-history-commit="${hash('a')}"]`)!)
    await settleReads()
    expect(mounted.commit).toHaveBeenCalledTimes(1)
  })

  it('settles the page ratio and keeps the commit page offset across containers', async () => {
    const mounted = await seeded({ refs: REFS, history: PAGE, commit: DETAIL, commitDiff: DIFF })
    await openHistory(mounted)
    const splitter = mounted.view.container.querySelector('[data-files-splitter]')!
    const workbench = splitter.parentElement!
    Object.defineProperty(workbench, 'getBoundingClientRect', {
      value: () => ({ left: 0, width: 1000, top: 0, right: 1000, bottom: 500, height: 500, x: 0, y: 0, toJSON: () => ({}) }),
      configurable: true,
    })
    splitter.setPointerCapture = () => {}
    splitter.releasePointerCapture = () => {}
    splitter.hasPointerCapture = () => true
    act(() => { fireEvent.pointerDown(splitter, { pointerId: 1, button: 0, clientX: 580 }) })
    act(() => { fireEvent.pointerUp(splitter, { pointerId: 1, clientX: 700 }) })
    expect(mounted.instance.getSnapshot().byTab[TAB]?.history.ratio).toBeCloseTo(0.7, 5)
    // The page offset is reported on unmount and restored on return.
    const page = mounted.view.container.querySelector<HTMLElement>('[data-files-history-page]')!
    page.scrollTop = 60
    fireEvent.scroll(page)
    fireEvent.click(mounted.view.container.querySelector('[data-files-rail-item="files"]')!)
    expect(mounted.instance.getSnapshot().byTab[TAB]?.history.pageScrollTop).toBe(60)
    fireEvent.click(mounted.view.container.querySelector('[data-files-rail-item="history"]')!)
    expect(mounted.view.container.querySelector<HTMLElement>('[data-files-history-page]')?.scrollTop).toBe(60)
  })

  it('drops a history answer a newer read of its kind superseded', async () => {
    const superseded = async (overrides: {
      readonly refs?: boolean
      readonly list?: boolean
      readonly commit?: boolean
      readonly diff?: boolean
    }) => {
      const mounted = await seeded({ refs: REFS, history: PAGE, commit: DETAIL, commitDiff: DIFF })
      if (overrides.refs === true) mounted.historyRefs.mockResolvedValueOnce({ value: REFS, current: false })
      if (overrides.list === true) mounted.history.mockResolvedValueOnce({ value: PAGE, current: false })
      if (overrides.commit === true) mounted.commit.mockResolvedValueOnce({ value: DETAIL, current: false })
      if (overrides.diff === true) mounted.commitDiff.mockResolvedValueOnce({ value: DIFF, current: false })
      await openHistory(mounted)
      return mounted
    }
    const refsStale = await superseded({ refs: true })
    expect(refsStale.instance.getSnapshot().byTab[TAB]?.history.refsLoading).toBe(true)
    expect(refsStale.instance.getSnapshot().byTab[TAB]?.history.refs).toBeUndefined()
    cleanup()
    const listStale = await superseded({ list: true })
    expect(listStale.instance.getSnapshot().byTab[TAB]?.history.commits).toEqual([])
    expect(listStale.instance.getSnapshot().byTab[TAB]?.history.loading).toBe(true)
    cleanup()
    const commitStale = await superseded({ commit: true })
    expect(commitStale.instance.getSnapshot().byTab[TAB]?.history.detail).toBe('loading')
    cleanup()
    const diffStale = await superseded({ diff: true })
    expect(diffStale.instance.getSnapshot().byTab[TAB]?.history.diff).toBe('loading')
  })

  it('drops a history read that settles after the tab record ended', async () => {
    // Refs read.
    const refsPending = await seeded({ refs: REFS, history: PAGE, commit: DETAIL, commitDiff: DIFF })
    let releaseRefs!: (answer: GitRead<readonly typeof REFS[number][]>) => void
    refsPending.historyRefs.mockImplementationOnce(() => new Promise((resolve) => { releaseRefs = resolve }))
    fireEvent.click(refsPending.view.container.querySelector('[data-files-rail-item="history"]')!)
    await act(async () => {})
    refsPending.controller.abort()
    await act(async () => { releaseRefs({ value: REFS, current: true }); await Promise.resolve() })
    expect(refsPending.instance.getSnapshot().byTab[TAB]).toBeUndefined()
    cleanup()
    // Page read.
    const listPending = await seeded({ refs: REFS, history: PAGE, commit: DETAIL, commitDiff: DIFF })
    let releaseList!: (answer: GitRead<WorkspaceGitHistory>) => void
    listPending.history.mockImplementationOnce(() => new Promise((resolve) => { releaseList = resolve }))
    fireEvent.click(listPending.view.container.querySelector('[data-files-rail-item="history"]')!)
    await settleReads()
    listPending.controller.abort()
    await act(async () => { releaseList({ value: PAGE, current: true }); await Promise.resolve() })
    expect(listPending.instance.getSnapshot().byTab[TAB]).toBeUndefined()
    cleanup()
    // Commit read.
    const commitPending = await seeded({ refs: REFS, history: PAGE, commit: DETAIL, commitDiff: DIFF })
    let releaseCommit!: (answer: GitRead<WorkspaceGitCommitDetail>) => void
    commitPending.commit.mockImplementationOnce(() => new Promise((resolve) => { releaseCommit = resolve }))
    fireEvent.click(commitPending.view.container.querySelector('[data-files-rail-item="history"]')!)
    await settleReads()
    commitPending.controller.abort()
    await act(async () => { releaseCommit({ value: DETAIL, current: true }); await Promise.resolve() })
    expect(commitPending.instance.getSnapshot().byTab[TAB]).toBeUndefined()
    cleanup()
    // Comparison read.
    const diffPending = await seeded({ refs: REFS, history: PAGE, commit: DETAIL, commitDiff: DIFF })
    let releaseDiff!: (answer: GitRead<WorkspaceFileDiff>) => void
    diffPending.commitDiff.mockImplementationOnce(() => new Promise((resolve) => { releaseDiff = resolve }))
    fireEvent.click(diffPending.view.container.querySelector('[data-files-rail-item="history"]')!)
    await settleReads()
    diffPending.controller.abort()
    await act(async () => { releaseDiff({ value: DIFF, current: true }); await Promise.resolve() })
    expect(diffPending.instance.getSnapshot().byTab[TAB]).toBeUndefined()
  })

  it('keeps the walked ref across a refresh whose refs still report it', async () => {
    const mounted = await seeded({ refs: REFS, history: PAGE, commit: DETAIL, commitDiff: DIFF })
    await openHistory(mounted)
    mounted.history.mockResolvedValueOnce({ value: PAGE, current: true })
    fireEvent.click(mounted.view.container.querySelector('[data-files-history-refs]')!)
    fireEvent.click(document.querySelector('[data-files-history-ref="dev"]')!)
    await settleReads()
    expect(mounted.instance.getSnapshot().byTab[TAB]?.history.ref).toBe('refs/heads/dev')
    fireEvent.click(mounted.view.container.querySelector('[data-files-history-refresh]')!)
    await settleReads()
    expect(mounted.history).toHaveBeenLastCalledWith(
      TAB, ROOT, { ref: 'refs/heads/dev', skip: 0, limit: 50 }, expect.anything(),
    )
  })

  it('keeps the newer commit page when an older read settles late', async () => {
    const mounted = await seeded({ refs: REFS, history: PAGE, commit: DETAIL, commitDiff: DIFF })
    await openHistory(mounted)
    const pending: Array<(answer: GitRead<WorkspaceGitCommitDetail>) => void> = []
    mounted.commit.mockImplementation(() => new Promise((resolve) => { pending.push(resolve) }))
    fireEvent.click(mounted.view.container.querySelector(`[data-files-history-commit="${hash('b')}"]`)!)
    await act(async () => {})
    fireEvent.click(mounted.view.container.querySelector(`[data-files-history-commit="${hash('c')}"]`)!)
    await act(async () => {})
    // The newer page settles first; the superseded read settles after it.
    pending[1]!({ value: DETAIL, current: true })
    await act(async () => {})
    pending[0]!({ value: DETAIL, current: true })
    await act(async () => {})
    expect(mounted.instance.getSnapshot().byTab[TAB]?.history.selected).toBe(hash('c'))
    expect(mounted.commit).toHaveBeenCalledTimes(3)
  })

  it('keeps the newer comparison when an older read settles late', async () => {
    const mounted = await seeded({ refs: REFS, history: PAGE, commit: DETAIL, commitDiff: DIFF })
    await openHistory(mounted)
    const pending: Array<(answer: GitRead<WorkspaceFileDiff>) => void> = []
    mounted.commitDiff.mockImplementation(() => new Promise((resolve) => { pending.push(resolve) }))
    fireEvent.click(mounted.view.container.querySelector('[data-files-history-file="packages/app/b.md"]')!)
    await act(async () => {})
    fireEvent.click(mounted.view.container.querySelector('[data-files-history-file="packages/app/src/a.ts"]')!)
    await act(async () => {})
    pending[1]!({ value: DIFF, current: true })
    await act(async () => {})
    pending[0]!({ value: DIFF, current: true })
    await act(async () => {})
    expect(mounted.instance.getSnapshot().byTab[TAB]?.history.file).toBe('packages/app/src/a.ts')
    expect(mounted.instance.getSnapshot().byTab[TAB]?.history.diff).toEqual(DIFF)
  })

  it('keeps the newer history page when an older read settles late', async () => {
    const mounted = await seeded({ refs: REFS, history: PAGE, commit: DETAIL, commitDiff: DIFF })
    await openHistory(mounted)
    const pending: Array<(answer: GitRead<WorkspaceGitHistory>) => void> = []
    mounted.history.mockImplementation(() => new Promise((resolve) => { pending.push(resolve) }))
    // A refresh starts a page read; walking another ref starts the read that
    // supersedes it before the first has answered.
    fireEvent.click(mounted.view.container.querySelector('[data-files-history-refresh]')!)
    await act(async () => {})
    fireEvent.click(mounted.view.container.querySelector('[data-files-history-refs]')!)
    fireEvent.click(document.querySelector('[data-files-history-ref="dev"]')!)
    await act(async () => {})
    expect(pending).toHaveLength(2)
    pending[1]!({ value: PAGE, current: true })
    await act(async () => {})
    // The superseded read settles after the page it replaced.
    pending[0]!({ value: PAGE, current: false })
    await act(async () => {})
    expect(mounted.instance.getSnapshot().byTab[TAB]?.history.ref).toBe('refs/heads/dev')
    expect(mounted.instance.getSnapshot().byTab[TAB]?.history.commits).toEqual(COMMITS)
  })

  it('keeps the newer refs when an older refs read settles late', async () => {
    const mounted = await seeded({ refs: REFS, history: PAGE, commit: DETAIL, commitDiff: DIFF })
    await openHistory(mounted)
    const pending: Array<(answer: GitRead<readonly typeof REFS[number][]>) => void> = []
    mounted.historyRefs.mockImplementation(() => new Promise((resolve) => { pending.push(resolve) }))
    fireEvent.click(mounted.view.container.querySelector('[data-files-history-refresh]')!)
    await act(async () => {})
    fireEvent.click(mounted.view.container.querySelector('[data-files-history-refresh]')!)
    await act(async () => {})
    const narrowed: readonly typeof REFS[number][] = [REFS[1]!]
    pending[1]!({ value: narrowed, current: true })
    await act(async () => {})
    pending[0]!({ value: REFS, current: false })
    await act(async () => {})
    expect(mounted.instance.getSnapshot().byTab[TAB]?.history.refs).toEqual(narrowed)
  })

  it('holds the page a refs settlement owes until the history container is back', async () => {
    const mounted = await seeded({ refs: REFS, history: PAGE, commit: DETAIL, commitDiff: DIFF })
    await openHistory(mounted)
    const reads = mounted.history.mock.calls.length
    // A refresh starts a refs read; the reader leaves before it answers.
    let release!: (answer: GitRead<readonly (typeof REFS)[number][]>) => void
    mounted.historyRefs.mockImplementationOnce(() => new Promise((resolve) => { release = resolve }))
    fireEvent.click(mounted.view.container.querySelector('[data-files-history-refresh]')!)
    await act(async () => {})
    fireEvent.click(mounted.view.container.querySelector('[data-files-rail-item="files"]')!)
    await act(async () => { release({ value: REFS, current: true }); await Promise.resolve() })
    // The refs landed for a view nobody is looking at, so no page read follows,
    // and the slice states that the page is still owed.
    expect(mounted.history.mock.calls.length).toBe(reads)
    expect(mounted.instance.getSnapshot().byTab[TAB]?.history.loading).toBe(true)
    // Returning fills the list rather than showing an empty one.
    fireEvent.click(mounted.view.container.querySelector('[data-files-rail-item="history"]')!)
    await settleReads()
    expect(mounted.history.mock.calls.length).toBe(reads + 1)
    expect(mounted.instance.getSnapshot().byTab[TAB]?.history.commits).toEqual(COMMITS)
  })

  it('makes no request before the history container is selected', async () => {
    const mounted = await seeded({ refs: REFS, history: PAGE, commit: DETAIL, commitDiff: DIFF })
    expect(mounted.historyRefs).not.toHaveBeenCalled()
    expect(mounted.history).not.toHaveBeenCalled()
    expect(mounted.commit).not.toHaveBeenCalled()
    // The copy the history view would draw is still reachable through the rail.
    expect(mounted.view.container.querySelector('[data-files-rail-item="history"]')?.getAttribute('aria-label'))
      .toBe(zh['rail.history'])
  })
})
