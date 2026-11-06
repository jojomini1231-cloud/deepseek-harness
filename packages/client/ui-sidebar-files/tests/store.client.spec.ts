/** Pane-local directory caches, expansion preferences, refresh settings, and navigator choices, and each `files` tab's workbench. */
import { describe, expect, it } from 'vitest'
import { RemoteError } from '@deepseek-ai/dsh-client-test-runtime'
import { createFilesStore } from '../src/client/store.ts'
import { DEFAULT_NAVIGATOR_WIDTH } from '../src/client/store.ts'
import type { DirLevel } from '../src/client/store.ts'
import { DEFAULT_RATIO, MAX_RATIO, MIN_RATIO } from '../src/client/store.ts'
import type { WorkspaceGitEntry } from '@deepseek-ai/dsh-workspace-changes/types'
import type { PaneId, TabId } from '@deepseek-ai/dsh-client-ui-dockkit'

const ROOT = '/work/app'
const PANE = 'pane-1' as PaneId
const TAB = 'tab-1' as TabId

const LEVEL: DirLevel = {
  entries: [{ name: 'src', type: 'directory' }, { name: 'README.md', type: 'file', size: 12 }],
  truncated: false,
}

const MODIFIED: WorkspaceGitEntry = { path: 'src/a.ts', display: 'src/a.ts', kind: 'modified' }

describe('createFilesStore', () => {
  it('mints an independent instance per call', () => {
    const first = createFilesStore().create()
    const second = createFilesStore().create()
    first.actions.start(PANE, ROOT)
    expect(second.getSnapshot().byPane[PANE]).toBeUndefined()
  })

  it('seeds a pane at its root with the root expanded and nothing loaded', () => {
    const store = createFilesStore().create()
    const { actions } = store
    const getSnapshot = (): ReturnType<typeof store.getSnapshot> => store.getSnapshot()
    actions.start(PANE, ROOT)
    expect(getSnapshot().byPane[PANE]).toEqual({
      open: undefined, width: DEFAULT_NAVIGATOR_WIDTH,
      tree: { root: ROOT, levels: {}, expanded: [ROOT], autoRefresh: true },
    })
  })

  it('shows a failed initial listing and replaces it with a successful retry', () => {
    const store = createFilesStore().create()
    const { actions } = store
    const getSnapshot = (): ReturnType<typeof store.getSnapshot> => store.getSnapshot()
    actions.start(PANE, ROOT)
    actions.loading(PANE, ROOT)
    expect(getSnapshot().byPane[PANE]!.tree!.levels[ROOT]).toEqual({ kind: 'loading' })
    const failure = new RemoteError('workspace-file/not-found', 'gone', { path: ROOT })
    actions.failed(PANE, ROOT, failure)
    expect(getSnapshot().byPane[PANE]!.tree!.levels[ROOT]).toEqual({ kind: 'failed', failure })
    actions.loading(PANE, ROOT)
    expect(getSnapshot().byPane[PANE]!.tree!.levels[ROOT]).toEqual({ kind: 'loading' })
    actions.loaded(PANE, ROOT, LEVEL)
    expect(getSnapshot().byPane[PANE]!.tree!.levels[ROOT]).toEqual({ kind: 'ready', level: LEVEL })
  })

  it('retains a loaded level marked as refreshing while it is listed again, until the listing settles or fails', () => {
    const store = createFilesStore().create()
    const { actions } = store
    const level = () => store.getSnapshot().byPane[PANE]!.tree!.levels[ROOT]
    actions.start(PANE, ROOT)
    actions.loaded(PANE, ROOT, LEVEL)
    actions.loading(PANE, ROOT)
    expect(level()).toEqual({ kind: 'ready', level: LEVEL, refreshing: true })
    // Marking it again changes nothing.
    const refreshing = store.getSnapshot()
    actions.loading(PANE, ROOT)
    expect(store.getSnapshot()).toBe(refreshing)
    const failure = new RemoteError('workspace-file/not-found', 'gone', { path: ROOT })
    actions.failed(PANE, ROOT, failure)
    expect(level()).toEqual({ kind: 'ready', level: LEVEL, failure })
    actions.loading(PANE, ROOT)
    expect(level()).toEqual({ kind: 'ready', level: LEVEL, failure, refreshing: true })
    actions.loaded(PANE, ROOT, LEVEL)
    expect(level()).toEqual({ kind: 'ready', level: LEVEL })
  })

  it('ends the refresh of every level below a directory whose listing fails, and of none beside it', () => {
    const store = createFilesStore().create()
    const { actions } = store
    const levels = () => store.getSnapshot().byPane[PANE]!.tree!.levels
    const src = `${ROOT}/src`
    const deep = `${src}/lib`
    const docs = `${src}/docs`
    const sibling = `${ROOT}/srcs`
    const failure = new RemoteError('workspace-file/not-found', 'gone', { path: deep })
    actions.start(PANE, ROOT)
    for (const path of [ROOT, src, deep, docs, sibling]) actions.loaded(PANE, path, LEVEL)
    actions.failed(PANE, deep, failure)
    for (const path of [ROOT, src, deep, sibling]) actions.loading(PANE, path)
    actions.loading(PANE, `${src}/new`)
    actions.failed(PANE, src, failure)
    expect(levels()[src]).toEqual({ kind: 'ready', level: LEVEL, failure })
    expect(levels()[deep]).toEqual({ kind: 'ready', level: LEVEL, failure })
    expect(levels()[docs]).toEqual({ kind: 'ready', level: LEVEL })
    expect(levels()[`${src}/new`]).toEqual({ kind: 'loading' })
    expect(levels()[ROOT]).toEqual({ kind: 'ready', level: LEVEL, refreshing: true })
    expect(levels()[sibling]).toEqual({ kind: 'ready', level: LEVEL, refreshing: true })
  })

  it('toggles a directory in and out of the expanded set without touching its level', () => {
    const store = createFilesStore().create()
    const { actions } = store
    const getSnapshot = (): ReturnType<typeof store.getSnapshot> => store.getSnapshot()
    const child = `${ROOT}/src`
    actions.start(PANE, ROOT)
    actions.loaded(PANE, child, LEVEL)
    actions.toggled(PANE, child)
    expect(getSnapshot().byPane[PANE]!.tree!.expanded).toEqual([ROOT, child])
    actions.toggled(PANE, child)
    expect(getSnapshot().byPane[PANE]!.tree!.expanded).toEqual([ROOT])
    expect(getSnapshot().byPane[PANE]!.tree!.levels[child]).toEqual({ kind: 'ready', level: LEVEL })
  })

  it('seeds a tab\'s workbench at its root with nothing open, the files view selected, and both views idle', () => {
    const store = createFilesStore().create()
    store.actions.workbenchStarted(TAB, ROOT)
    expect(store.getSnapshot().byTab[TAB]).toEqual({
      root: ROOT, open: [], active: undefined, ratio: DEFAULT_RATIO, pageOpen: false, container: 'files',
      git: {
        status: undefined, loading: false, failure: false, selected: undefined, selectedFrom: undefined,
        scrollTop: 0, diff: undefined, diffMode: 'unified', diffComplete: false, ratio: 0.58, pageOpen: false, groups: { changed: true, untracked: true },
      },
      history: {
        refs: undefined, refsLoading: false, refsFailure: false, ref: undefined, refPicked: false,
        commits: [], listEpoch: 0, hasMore: false, loading: false, failure: false,
        selected: undefined, file: undefined, filesOpen: true,
        detail: undefined, diff: undefined, diffMode: 'unified', diffComplete: false,
        listScrollTop: 0, pageScrollTop: 0, ratio: 0.58, pageOpen: false,
      },
    })
    // The workbench is the tab's; the pane's tree is the navigator's.
    expect(store.getSnapshot().byPane).toEqual({})
  })

  it('opens, shows, and closes files by absolute path, keeping chip order and a neighbour', () => {
    const store = createFilesStore().create()
    const { actions } = store
    const getSnapshot = (): ReturnType<typeof store.getSnapshot> => store.getSnapshot()
    const a = { path: `${ROOT}/a.md`, address: `dsh-resource://file/session/s${ROOT}/a.md`, name: 'a.md' }
    const b = { path: `${ROOT}/b.ts`, address: `dsh-resource://file/session/s${ROOT}/b.ts`, name: 'b.ts' }
    actions.workbenchStarted(TAB, ROOT)
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
    actions.workbenchStarted(TAB, ROOT)
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
    store.actions.workbenchStarted(TAB, ROOT)
    expect(store.getSnapshot().byTab[TAB]?.container).toBe('files')
    store.actions.containerSelected(TAB, 'history')
    expect(store.getSnapshot().byTab[TAB]?.container).toBe('history')
  })

  it('closes the narrow files drill-down when the last chip closes', () => {
    const store = createFilesStore().create()
    const { actions } = store
    const file = { path: `${ROOT}/a.md`, address: `dsh-resource://file/session/s${ROOT}/a.md`, name: 'a.md' }
    actions.workbenchStarted(TAB, ROOT)
    actions.fileOpened(TAB, file)
    actions.filesPageOpened(TAB, true)
    // Closing the shown file by its own chip is the other route out of the
    // drill-down: the preview it showed is gone, so the state goes with it.
    actions.fileClosed(TAB, file.path)
    expect(store.getSnapshot().byTab[TAB]?.pageOpen).toBe(false)
  })

  it('closes the git drill-down when a status read drops the shown path', () => {
    const store = createFilesStore().create()
    const { actions } = store
    actions.workbenchStarted(TAB, ROOT)
    actions.gitStatusLoaded(TAB, { kind: 'repository', total: 1, entries: [MODIFIED] })
    actions.gitEntrySelected(TAB, MODIFIED.path, undefined)
    actions.gitPageOpened(TAB, true)
    // The file was committed or reverted while the reader had it open.
    actions.gitStatusLoaded(TAB, { kind: 'repository', total: 0, entries: [] })
    const git = store.getSnapshot().byTab[TAB]?.git
    expect(git?.selected).toBeUndefined()
    expect(git?.pageOpen).toBe(false)
  })

  it('records each container\'s narrow drill-down and closes it with the last file', () => {
    const store = createFilesStore().create()
    const { actions } = store
    const file = { path: `${ROOT}/a.md`, address: `dsh-resource://file/session/s${ROOT}/a.md`, name: 'a.md' }
    actions.workbenchStarted(TAB, ROOT)
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
    actions.workbenchStarted(TAB, ROOT)
    actions.ratioChanged(TAB, 0.05)
    expect(store.getSnapshot().byTab[TAB]?.ratio).toBe(MIN_RATIO)
    actions.ratioChanged(TAB, 0.95)
    expect(store.getSnapshot().byTab[TAB]?.ratio).toBe(MAX_RATIO)
    actions.ratioChanged(TAB, 0.33)
    expect(store.getSnapshot().byTab[TAB]?.ratio).toBe(0.33)
  })

  it('collapses a pane\'s tree back to its root and keeps the loaded levels', () => {
    const store = createFilesStore().create()
    const { actions } = store
    const child = `${ROOT}/src`
    actions.start(PANE, ROOT)
    actions.loaded(PANE, ROOT, LEVEL)
    actions.toggled(PANE, child)
    actions.loaded(PANE, child, LEVEL)
    actions.collapsed(PANE)
    const state = store.getSnapshot().byPane[PANE]!.tree!
    expect(state.expanded).toEqual([ROOT])
    expect(Object.keys(state.levels)).toEqual([ROOT, child])
  })

  it('keeps the automatic setting independent for each pane', () => {
    const store = createFilesStore().create()
    const other = 'pane-2' as PaneId
    store.actions.start(PANE, ROOT)
    store.actions.start(other, ROOT)
    store.actions.autoRefresh(PANE, false)
    expect(store.getSnapshot().byPane[PANE]!.tree!.autoRefresh).toBe(false)
    expect(store.getSnapshot().byPane[other]!.tree!.autoRefresh).toBe(true)
    store.actions.autoRefresh(PANE, true)
    expect(store.getSnapshot().byPane[PANE]!.tree!.autoRefresh).toBe(true)
  })

  it.each(['removed', 'file'] as const)('drops cached descendants and expansion when a directory is %s', (replacement) => {
    const store = createFilesStore().create()
    const { actions } = store
    const child = `${ROOT}/src`
    const grandchild = `${child}/nested`
    const sibling = `${ROOT}/src-other`
    actions.start(PANE, ROOT)
    actions.loaded(PANE, ROOT, { entries: [
      { name: 'src', type: 'directory' }, { name: 'src-other', type: 'directory' },
    ], truncated: false })
    for (const path of [child, grandchild, sibling]) {
      actions.toggled(PANE, path)
      actions.loaded(PANE, path, LEVEL)
    }
    actions.loaded(PANE, ROOT, { entries: replacement === 'file'
      ? [{ name: 'src', type: 'file' }, { name: 'src-other', type: 'directory' }]
      : [{ name: 'src-other', type: 'directory' }], truncated: false })
    const state = store.getSnapshot().byPane[PANE]!.tree!
    expect(state.expanded).toEqual([ROOT, sibling])
    expect(Object.keys(state.levels)).toEqual([ROOT, sibling])
    expect(state.levels[sibling]).toEqual({ kind: 'ready', level: LEVEL })
  })

  it('keeps the navigator\'s choices before and across a tree started at a new root', () => {
    const store = createFilesStore().create()
    const { actions } = store
    actions.shown(PANE, true)
    actions.resized(PANE, 320)
    expect(store.getSnapshot().byPane[PANE]).toEqual({ open: true, width: 320, tree: undefined })
    actions.start(PANE, ROOT)
    actions.loaded(PANE, ROOT, LEVEL)
    actions.start(PANE, '/work/other')
    expect(store.getSnapshot().byPane[PANE]).toEqual({
      open: true, width: 320,
      tree: { root: '/work/other', levels: {}, expanded: ['/work/other'], autoRefresh: true },
    })
  })

  it('refuses to write a level for a pane whose tree was never started', () => {
    const { actions } = createFilesStore().create()
    expect(() => { actions.loading('pane-nowhere' as PaneId, ROOT) }).toThrow('no tree for pane "pane-nowhere"')
  })

  it('forget removes exactly the pane that went away', () => {
    const store = createFilesStore().create()
    const { actions } = store
    const getSnapshot = (): ReturnType<typeof store.getSnapshot> => store.getSnapshot()
    actions.start(PANE, ROOT)
    actions.start('pane-2' as PaneId, ROOT)
    actions.forget(PANE)
    expect(Object.keys(getSnapshot().byPane)).toEqual(['pane-2'])
  })

  it('forgets exactly the workbench of the tab that went away, and leaves the pane\'s tree', () => {
    const store = createFilesStore().create()
    const { actions } = store
    actions.start(PANE, ROOT)
    actions.workbenchStarted(TAB, ROOT)
    actions.workbenchStarted('tab-2' as TabId, ROOT)
    actions.workbenchForgotten(TAB)
    expect(Object.keys(store.getSnapshot().byTab)).toEqual(['tab-2'])
    expect(store.getSnapshot().byPane[PANE]?.tree?.root).toBe(ROOT)
  })

  it('refuses to write a workbench for a tab that was never started', () => {
    const { actions } = createFilesStore().create()
    expect(() => { actions.ratioChanged('tab-nowhere' as TabId, 0.5) }).toThrow('no workbench for tab "tab-nowhere"')
  })
})
