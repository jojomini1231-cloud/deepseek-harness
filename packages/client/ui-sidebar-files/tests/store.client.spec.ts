/** Tab-local directory caches, expansion preferences, and refresh settings. */
import { describe, expect, it } from 'vitest'
import { RemoteError } from '@deepseek-ai/dsh-client-test-runtime'
import { createFilesStore } from '../src/client/store.ts'
import type { DirLevel } from '../src/client/store.ts'
import { DEFAULT_RATIO, MAX_RATIO, MIN_RATIO } from '../src/client/store.ts'
import type { TabId } from '@deepseek-ai/dsh-client-ui-dockkit'

const ROOT = '/work/app'
const TAB = 'tab-1' as TabId

const LEVEL: DirLevel = {
  entries: [{ name: 'src', type: 'directory' }, { name: 'README.md', type: 'file', size: 12 }],
  truncated: false,
}

describe('createFilesStore', () => {
  it('mints an independent instance per call', () => {
    const first = createFilesStore().create()
    const second = createFilesStore().create()
    first.actions.start(TAB, ROOT)
    expect(second.getSnapshot().byTab[TAB]).toBeUndefined()
  })

  it('seeds a tab at its root with the root expanded and nothing loaded', () => {
    const store = createFilesStore().create()
    const { actions } = store
    const getSnapshot = (): ReturnType<typeof store.getSnapshot> => store.getSnapshot()
    actions.start(TAB, ROOT)
    expect(getSnapshot().byTab[TAB]).toEqual({
      root: ROOT, levels: {}, expanded: [ROOT], scrollTop: 0, autoRefresh: true,
      open: [], active: undefined, ratio: DEFAULT_RATIO, pageOpen: false, container: 'files',
      git: {
        status: undefined, loading: false, failure: false, selected: undefined, selectedFrom: undefined,
        scrollTop: 0, diff: undefined, diffMode: 'unified', ratio: 0.58, pageOpen: false, groups: { changed: true, untracked: true },
      },
      history: {
        refs: undefined, refsLoading: false, refsFailure: false, ref: undefined,
        commits: [], listEpoch: 0, hasMore: false, loading: false, failure: false,
        selected: undefined, file: undefined, filesOpen: true,
        detail: undefined, diff: undefined, diffMode: 'unified',
        listScrollTop: 0, pageScrollTop: 0, ratio: 0.58, pageOpen: false,
      },
    })
  })

  it('shows a failed initial listing and replaces it with a successful retry', () => {
    const store = createFilesStore().create()
    const { actions } = store
    const getSnapshot = (): ReturnType<typeof store.getSnapshot> => store.getSnapshot()
    actions.start(TAB, ROOT)
    actions.loading(TAB, ROOT)
    expect(getSnapshot().byTab[TAB]!.levels[ROOT]).toEqual({ kind: 'loading' })
    const failure = new RemoteError('workspace-file/not-found', 'gone', { path: ROOT })
    actions.failed(TAB, ROOT, failure)
    expect(getSnapshot().byTab[TAB]!.levels[ROOT]).toEqual({ kind: 'failed', failure })
    actions.loading(TAB, ROOT)
    expect(getSnapshot().byTab[TAB]!.levels[ROOT]).toEqual({ kind: 'loading' })
    actions.loaded(TAB, ROOT, LEVEL)
    expect(getSnapshot().byTab[TAB]!.levels[ROOT]).toEqual({ kind: 'ready', level: LEVEL })
  })

  it('retains a loaded level during refresh and beside a refresh failure', () => {
    const store = createFilesStore().create()
    const { actions } = store
    actions.start(TAB, ROOT)
    actions.loaded(TAB, ROOT, LEVEL)
    const cached = store.getSnapshot().byTab[TAB]!.levels[ROOT]
    actions.loading(TAB, ROOT)
    expect(store.getSnapshot().byTab[TAB]!.levels[ROOT]).toBe(cached)
    const failure = new RemoteError('workspace-file/not-found', 'gone', { path: ROOT })
    actions.failed(TAB, ROOT, failure)
    expect(store.getSnapshot().byTab[TAB]!.levels[ROOT]).toEqual({ kind: 'ready', level: LEVEL, failure })
    actions.loaded(TAB, ROOT, LEVEL)
    expect(store.getSnapshot().byTab[TAB]!.levels[ROOT]).toEqual({ kind: 'ready', level: LEVEL })
  })

  it('toggles a directory in and out of the expanded set without touching its level', () => {
    const store = createFilesStore().create()
    const { actions } = store
    const getSnapshot = (): ReturnType<typeof store.getSnapshot> => store.getSnapshot()
    const child = `${ROOT}/src`
    actions.start(TAB, ROOT)
    actions.loaded(TAB, child, LEVEL)
    actions.toggled(TAB, child)
    expect(getSnapshot().byTab[TAB]!.expanded).toEqual([ROOT, child])
    actions.toggled(TAB, child)
    expect(getSnapshot().byTab[TAB]!.expanded).toEqual([ROOT])
    expect(getSnapshot().byTab[TAB]!.levels[child]).toEqual({ kind: 'ready', level: LEVEL })
  })

  it('opens, shows, and closes files by absolute path, keeping chip order and a neighbour', () => {
    const store = createFilesStore().create()
    const { actions } = store
    const getSnapshot = (): ReturnType<typeof store.getSnapshot> => store.getSnapshot()
    const a = { path: `${ROOT}/a.md`, address: `dsh-resource://file/session/s${ROOT}/a.md`, name: 'a.md' }
    const b = { path: `${ROOT}/b.ts`, address: `dsh-resource://file/session/s${ROOT}/b.ts`, name: 'b.ts' }
    actions.start(TAB, ROOT)
    // Writes for a path that is not open change nothing.
    actions.fileClosed(TAB, a.path)
    actions.fileActivated(TAB, a.path)
    expect(getSnapshot().byTab[TAB]?.open).toEqual([])
    actions.fileOpened(TAB, a)
    actions.fileOpened(TAB, b)
    expect(getSnapshot().byTab[TAB]?.open).toEqual([a, b])
    expect(getSnapshot().byTab[TAB]?.active).toBe(b.path)
    // Showing an open file keeps the chip order; reopening it does the same.
    actions.fileActivated(TAB, a.path)
    expect(getSnapshot().byTab[TAB]?.open).toEqual([a, b])
    expect(getSnapshot().byTab[TAB]?.active).toBe(a.path)
    actions.fileOpened(TAB, a)
    expect(getSnapshot().byTab[TAB]?.open).toEqual([a, b])
    expect(getSnapshot().byTab[TAB]?.active).toBe(a.path)
    // Closing the shown chip shows the next one, then the previous, then nothing.
    actions.fileClosed(TAB, a.path)
    expect(getSnapshot().byTab[TAB]?.open).toEqual([b])
    expect(getSnapshot().byTab[TAB]?.active).toBe(b.path)
    actions.fileOpened(TAB, a)
    actions.fileClosed(TAB, b.path)
    expect(getSnapshot().byTab[TAB]?.active).toBe(a.path)
    actions.fileClosed(TAB, a.path)
    expect(getSnapshot().byTab[TAB]?.open).toEqual([])
    expect(getSnapshot().byTab[TAB]?.active).toBeUndefined()
  })

  it('closes chips in bulk, keeping the chip each arm leaves open', () => {
    const store = createFilesStore().create()
    const { actions } = store
    const getSnapshot = (): ReturnType<typeof store.getSnapshot> => store.getSnapshot()
    const open = (): readonly string[] | undefined => getSnapshot().byTab[TAB]?.open.map(entry => entry.path)
    const active = (): string | undefined => getSnapshot().byTab[TAB]?.active
    const file = (name: string) => ({ path: `${ROOT}/${name}`, address: `dsh-resource://file/session/s${ROOT}/${name}`, name })
    const a = file('a.md'), b = file('b.ts'), c = file('c.yml')
    const openAll = (): void => {
      actions.filesClosedAll(TAB)
      for (const entry of [a, b, c]) actions.fileOpened(TAB, entry)
    }
    actions.start(TAB, ROOT)
    // Closing everything empties the column, and every arm on a chip that is not
    // open leaves the column alone.
    openAll()
    actions.filesClosedAll(TAB)
    expect(open()).toEqual([])
    expect(active()).toBeUndefined()
    actions.filesClosedExcept(TAB, a.path)
    actions.filesClosedBefore(TAB, a.path)
    actions.filesClosedAfter(TAB, a.path)
    expect(open()).toEqual([])
    // Others: the named chip survives and becomes the shown one.
    openAll()
    actions.filesClosedExcept(TAB, b.path)
    expect(open()).toEqual([b.path])
    expect(active()).toBe(b.path)
    // Left: the named chip and the ones after it keep their order.
    openAll()
    actions.filesClosedBefore(TAB, b.path)
    expect(open()).toEqual([b.path, c.path])
    expect(active()).toBe(c.path)
    // A shown file whose chip the arm closes falls back to that arm's chip.
    openAll()
    actions.filesClosedAfter(TAB, a.path)
    expect(open()).toEqual([a.path])
    expect(active()).toBe(a.path)
    openAll()
    actions.fileActivated(TAB, a.path)
    actions.filesClosedBefore(TAB, c.path)
    expect(open()).toEqual([c.path])
    expect(active()).toBe(c.path)
    // A shown file the arm leaves open stays shown.
    openAll()
    actions.fileActivated(TAB, a.path)
    actions.filesClosedAfter(TAB, b.path)
    expect(open()).toEqual([a.path, b.path])
    expect(active()).toBe(a.path)
    // An arm with nothing on its side leaves the open set as it was.
    openAll()
    actions.filesClosedAfter(TAB, c.path)
    actions.filesClosedBefore(TAB, a.path)
    expect(open()).toEqual([a.path, b.path, c.path])
    expect(active()).toBe(c.path)
  })

  it('records the activity rail selection', () => {
    const store = createFilesStore().create()
    store.actions.start(TAB, ROOT)
    expect(store.getSnapshot().byTab[TAB]?.container).toBe('files')
    store.actions.containerSelected(TAB, 'history')
    expect(store.getSnapshot().byTab[TAB]?.container).toBe('history')
  })

  it('records each container\'s narrow drill-down and closes it with the last file', () => {
    const store = createFilesStore().create()
    const { actions } = store
    const file = { path: `${ROOT}/a.md`, address: `dsh-resource://file/session/s${ROOT}/a.md`, name: 'a.md' }
    actions.start(TAB, ROOT)
    actions.filesPageOpened(TAB, true)
    expect(store.getSnapshot().byTab[TAB]?.pageOpen).toBe(true)
    actions.fileOpened(TAB, file)
    actions.filesClosedAll(TAB)
    expect(store.getSnapshot().byTab[TAB]?.pageOpen).toBe(false)
    actions.gitPageOpened(TAB, true)
    expect(store.getSnapshot().byTab[TAB]?.git.pageOpen).toBe(true)
    actions.gitPageOpened(TAB, false)
    expect(store.getSnapshot().byTab[TAB]?.git.pageOpen).toBe(false)
  })

  it('keeps a divider drag inside its range', () => {
    const store = createFilesStore().create()
    const { actions } = store
    actions.start(TAB, ROOT)
    actions.ratioChanged(TAB, 0.05)
    expect(store.getSnapshot().byTab[TAB]?.ratio).toBe(MIN_RATIO)
    actions.ratioChanged(TAB, 0.95)
    expect(store.getSnapshot().byTab[TAB]?.ratio).toBe(MAX_RATIO)
    actions.ratioChanged(TAB, 0.33)
    expect(store.getSnapshot().byTab[TAB]?.ratio).toBe(0.33)
  })

  it('reset drops levels while keeping expansion, scroll, and the automatic setting', () => {
    const store = createFilesStore().create()
    const { actions } = store
    const getSnapshot = (): ReturnType<typeof store.getSnapshot> => store.getSnapshot()
    const child = `${ROOT}/src`
    actions.start(TAB, ROOT)
    actions.loaded(TAB, ROOT, LEVEL)
    actions.toggled(TAB, child)
    actions.loaded(TAB, child, LEVEL)
    actions.scrolled(TAB, 120)
    actions.autoRefresh(TAB, false)
    actions.reset(TAB)
    expect(getSnapshot().byTab[TAB]).toEqual({
      root: ROOT, levels: {}, expanded: [ROOT, child], scrollTop: 120, autoRefresh: false,
      open: [], active: undefined, ratio: DEFAULT_RATIO, pageOpen: false, container: 'files',
      git: {
        status: undefined, loading: false, failure: false, selected: undefined, selectedFrom: undefined,
        scrollTop: 0, diff: undefined, diffMode: 'unified', ratio: 0.58, pageOpen: false, groups: { changed: true, untracked: true },
      },
      history: {
        refs: undefined, refsLoading: false, refsFailure: false, ref: undefined,
        commits: [], listEpoch: 0, hasMore: false, loading: false, failure: false,
        selected: undefined, file: undefined, filesOpen: true,
        detail: undefined, diff: undefined, diffMode: 'unified',
        listScrollTop: 0, pageScrollTop: 0, ratio: 0.58, pageOpen: false,
      },
    })
  })

  it('keeps the automatic setting independent for each tab', () => {
    const store = createFilesStore().create()
    const other = 'tab-2' as TabId
    store.actions.start(TAB, ROOT)
    store.actions.start(other, ROOT)
    store.actions.autoRefresh(TAB, false)
    expect(store.getSnapshot().byTab[TAB]!.autoRefresh).toBe(false)
    expect(store.getSnapshot().byTab[other]!.autoRefresh).toBe(true)
    store.actions.autoRefresh(TAB, true)
    expect(store.getSnapshot().byTab[TAB]!.autoRefresh).toBe(true)
  })

  it.each(['removed', 'file'] as const)('drops cached descendants and expansion when a directory is %s', (replacement) => {
    const store = createFilesStore().create()
    const { actions } = store
    const child = `${ROOT}/src`
    const grandchild = `${child}/nested`
    const sibling = `${ROOT}/src-other`
    actions.start(TAB, ROOT)
    actions.loaded(TAB, ROOT, { entries: [
      { name: 'src', type: 'directory' }, { name: 'src-other', type: 'directory' },
    ], truncated: false })
    for (const path of [child, grandchild, sibling]) {
      actions.toggled(TAB, path)
      actions.loaded(TAB, path, LEVEL)
    }
    actions.loaded(TAB, ROOT, { entries: replacement === 'file'
      ? [{ name: 'src', type: 'file' }, { name: 'src-other', type: 'directory' }]
      : [{ name: 'src-other', type: 'directory' }], truncated: false })
    const state = store.getSnapshot().byTab[TAB]!
    expect(state.expanded).toEqual([ROOT, sibling])
    expect(Object.keys(state.levels)).toEqual([ROOT, sibling])
    expect(state.levels[sibling]).toEqual({ kind: 'ready', level: LEVEL })
  })

  it('remembers where the body is scrolled to', () => {
    const store = createFilesStore().create()
    const { actions } = store
    actions.start(TAB, ROOT)
    actions.scrolled(TAB, 120)
    expect(store.getSnapshot().byTab[TAB]!.scrollTop).toBe(120)
  })

  it('refuses to write a level for a tab that was never started', () => {
    const { actions } = createFilesStore().create()
    expect(() => { actions.loading('tab-nowhere' as TabId, ROOT) }).toThrow('no tree for tab "tab-nowhere"')
  })

  it('forget removes exactly the tab that went away', () => {
    const store = createFilesStore().create()
    const { actions } = store
    const getSnapshot = (): ReturnType<typeof store.getSnapshot> => store.getSnapshot()
    actions.start(TAB, ROOT)
    actions.start('tab-2' as TabId, ROOT)
    actions.forget(TAB)
    expect(Object.keys(getSnapshot().byTab)).toEqual(['tab-2'])
  })
})
