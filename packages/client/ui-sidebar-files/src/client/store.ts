/**
 * The workbench's view state: which directories are expanded, what each loaded
 * level contains, where the tree is scrolled to, which files are open in the
 * content column, and how the two columns are divided.
 *
 * The tree is not one resource. A directory listing per level, expanded lazily,
 * is state the type owns — so it lives in a Slot-standard exclusive store
 * (one instance per session), bucketed by tab id because two tabs of this kind
 * in one session expand, open, and divide independently.
 *
 * Writers run between `start` and `forget`: the owner's `signal` is what ends a
 * bucket's life, and the face stops dispatching once it aborts.
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import type { RemoteFailure } from '@deepseek-ai/dsh-api-remotes/client'
import type {
  WorkspaceFileDiff, WorkspaceGitCommit, WorkspaceGitCommitDetail, WorkspaceGitHistory, WorkspaceGitRef,
  WorkspaceGitStatus,
} from '@deepseek-ai/dsh-workspace-changes/types'
import { sameGitStatus } from '../git.ts'
import type { TabId } from '@deepseek-ai/dsh-client-ui-dockkit'
import type { WorkspaceDirectoryEntry } from '@deepseek-ai/dsh-api-workspace-files/types'

/**
 * One directory's contents, as one expanded level of the tree.
 *
 * The endpoint's listing also names the directory as a workspace-relative path;
 * the tree keys every level by absolute path instead, so the adapter drops it.
 */
export interface DirLevel {
  /** The directory's entries, in the endpoint's order. */
  readonly entries: readonly WorkspaceDirectoryEntry[]
  /** The listing hit the endpoint's entry cap, so entries are missing. */
  readonly truncated: boolean
}

/** What one directory level is doing right now. */
export type LevelState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly level: DirLevel; readonly failure?: RemoteFailure }
  | { readonly kind: 'failed'; readonly failure: RemoteFailure }

/** One file open in the workbench's content column. */
export interface OpenFile {
  /** Absolute path in the file's execution environment; the workbench's identity for the file. */
  readonly path: string
  /** The file's `dsh-resource://file/...` address, as the preview reads it. */
  readonly address: string
  /** The file's name, as its chip shows it. */
  readonly name: string
}

/** How the workbench's two columns divide, as the content column's share. */
export const DEFAULT_RATIO = 0.6

/** How the git view's two columns divide, as the comparison column's share. */
export const DEFAULT_GIT_RATIO = 0.58

/** How the history view's two columns divide, as the commit page's share. */
export const DEFAULT_HISTORY_RATIO = 0.58

/** The narrowest share a divider drag may leave the content column. */
export const MIN_RATIO = 0.2

/** The widest share a divider drag may leave the content column. */
export const MAX_RATIO = 0.8

/** The workbench's view containers, in rail order. */
export type WorkbenchContainer = 'files' | 'git' | 'history'

/**
 * One tab's workbench: its root, the levels it has asked for, and what it shows.
 *
 * Every path here is absolute: the root is the session's working directory as
 * the Host reports it, and a child is the parent joined with the entry name.
 */
export interface FilesTabState {
  autoRefresh: boolean
  /** Absolute path of the workspace root this tree is rooted at. */
  root: string
  /** Level state by absolute directory path; a path absent here was never asked for. */
  levels: Record<string, LevelState>
  /** Expanded absolute directory paths, root included. */
  expanded: string[]
  /** The body's scroll offset in px, so a remounted tree comes back where the reader was. */
  scrollTop: number
  /** Files open in the content column, in the order their chips were opened. */
  open: readonly OpenFile[]
  /** Absolute path of the file the content column shows; `undefined` while nothing is open. */
  active: string | undefined
  /** The content column's share of the workbench, between `MIN_RATIO` and `MAX_RATIO`. */
  ratio: number
  /** Whether the narrow layout's file-preview drill-down is open. */
  pageOpen: boolean
  /** Id of the view container the activity rail has selected. */
  container: WorkbenchContainer
  /** The working tree's git view. */
  git: GitTabState
  /** The repository's history view. */
  history: HistoryTabState
}

/**
 * The working tree's git view: what the status read last answered, which path
 * the panel shows, and that path's comparison.
 */
export interface GitTabState {
  /** The last settled status, `undefined` until the first answer arrives. */
  status: WorkspaceGitStatus | undefined
  /** Whether a status read is in flight. */
  loading: boolean
  /** Whether the latest status read failed; the panel keeps a retry reachable while the answer is unknown. */
  failure: boolean
  /** Path the panel shows, relative to the working directory. */
  selected: string | undefined
  /** The selected entry's rename or copy origin, echoed in its comparison request. */
  selectedFrom: string | undefined
  /** The changed-path list's scroll offset in px, so the list comes back where the reader was. */
  scrollTop: number
  /** The selected path's comparison, or why the panel has none yet. */
  diff: WorkspaceFileDiff | 'loading' | 'failed' | undefined
  /** How the comparison is laid out: one unified column, or both sides. */
  diffMode: 'unified' | 'split'
  /** The comparison column's share of the git view, between `MIN_RATIO` and `MAX_RATIO`. */
  ratio: number
  /** Whether the narrow layout's comparison drill-down is open. */
  pageOpen: boolean
  /** Which changed-path groups are open; both start expanded. */
  groups: { changed: boolean; untracked: boolean }
}

/**
 * The repository's history view: the refs filter, the loaded pages of commits,
 * the selected commit's page, its file list fold, and that file's comparison.
 */
export interface HistoryTabState {
  /** The refs the filter offers, `undefined` until the first answer arrives. */
  refs: readonly WorkspaceGitRef[] | undefined
  /** Whether a refs read is in flight. */
  refsLoading: boolean
  /** Whether the latest refs read failed. */
  refsFailure: boolean
  /** Full ref name the list walks, such as `refs/heads/dev`; `undefined` walks the repository's `HEAD`. */
  ref: string | undefined
  /** Commits loaded so far, newest first. */
  commits: readonly WorkspaceGitCommit[]
  /**
   * The loaded list's generation, advanced whenever the list is restarted. A
   * load-more records it when it is asked and appends only while it still
   * holds, so a page read against a list that was since replaced cannot
   * continue the one that replaced it, even when the ref and the page offset
   * match again. A first page needs no generation: it replaces the list, and
   * the body only dispatches the list's newest read.
   */
  listEpoch: number
  /** Whether the walked ref has commits after the loaded pages. */
  hasMore: boolean
  /** Whether a history page is being read; a page that lands clears it. */
  loading: boolean
  /** Whether the latest history page read failed; the loaded pages stay on screen. */
  failure: boolean
  /** Hash of the commit whose page is shown, `undefined` before the first pick. */
  selected: string | undefined
  /** Path of the changed file whose comparison is shown. */
  file: string | undefined
  /** The selected commit's file section is expanded. */
  filesOpen: boolean
  /** The selected commit's message and changed files, or why the page has none yet. */
  detail: WorkspaceGitCommitDetail | 'loading' | 'failed' | undefined
  /** The selected file's comparison, or why the panel has none yet. */
  diff: WorkspaceFileDiff | 'loading' | 'failed' | undefined
  /** How the comparison is laid out: one unified column, or both sides. */
  diffMode: 'unified' | 'split'
  /** The commit list's scroll offset in px, so the list comes back where the reader was. */
  listScrollTop: number
  /** The commit page's scroll offset in px, for the commit it was read on. */
  pageScrollTop: number
  /** The commit page's share of the history view, between `MIN_RATIO` and `MAX_RATIO`. */
  ratio: number
  /** Whether the narrow layout's commit page drill-down is open. */
  pageOpen: boolean
}

/**
 * Drop the loaded page and everything read from it, so the next page starts a
 * list the reader has not seen: a ref pick and a ref that disappeared from the
 * repository both restart this way.
 * @param history - the tab's history slice.
 */
function resetHistoryList(history: HistoryTabState): void {
  history.commits = []
  // Every load-more asked under the replaced list now carries an older epoch.
  history.listEpoch += 1
  history.hasMore = false
  history.loading = false
  history.failure = false
  history.selected = undefined
  history.file = undefined
  history.detail = undefined
  history.diff = undefined
  history.pageOpen = false
}

/** Every tab's tree, keyed by tab id. */
export interface FilesState {
  byTab: Record<TabId, FilesTabState>
}

/**
 * One tab's bucket, which every writer after `start` relies on: the face only
 * dispatches while the record's signal is live, and `forget` runs on its abort.
 * @param state - the draft.
 * @param tabId - the tab being written.
 * @returns the tab's tree.
 */
function bucket(state: FilesState, tabId: TabId): FilesTabState {
  const tree = state.byTab[tabId]
  if (tree === undefined) throw new Error(`ui-sidebar-files: no tree for tab "${tabId}"`)
  return tree
}

/** The tree store's write set; every action names the tab it writes. */
type FilesActions = {
  autoRefresh: (draft: FilesState, tabId: TabId, enabled: boolean) => void
  start: (draft: FilesState, tabId: TabId, root: string) => void
  loading: (draft: FilesState, tabId: TabId, path: string) => void
  loaded: (draft: FilesState, tabId: TabId, path: string, level: DirLevel) => void
  failed: (draft: FilesState, tabId: TabId, path: string, failure: RemoteFailure) => void
  toggled: (draft: FilesState, tabId: TabId, path: string) => void
  scrolled: (draft: FilesState, tabId: TabId, scrollTop: number) => void
  fileOpened: (draft: FilesState, tabId: TabId, file: OpenFile) => void
  fileClosed: (draft: FilesState, tabId: TabId, path: string) => void
  fileActivated: (draft: FilesState, tabId: TabId, path: string) => void
  filesClosedExcept: (draft: FilesState, tabId: TabId, path: string) => void
  filesClosedAll: (draft: FilesState, tabId: TabId) => void
  filesClosedBefore: (draft: FilesState, tabId: TabId, path: string) => void
  filesClosedAfter: (draft: FilesState, tabId: TabId, path: string) => void
  ratioChanged: (draft: FilesState, tabId: TabId, ratio: number) => void
  filesPageOpened: (draft: FilesState, tabId: TabId, open: boolean) => void
  collapsed: (draft: FilesState, tabId: TabId) => void
  containerSelected: (draft: FilesState, tabId: TabId, container: WorkbenchContainer) => void
  gitLoading: (draft: FilesState, tabId: TabId) => void
  gitStatusLoaded: (draft: FilesState, tabId: TabId, status: WorkspaceGitStatus) => void
  gitStatusFailed: (draft: FilesState, tabId: TabId) => void
  gitEntrySelected: (draft: FilesState, tabId: TabId, path: string, from: string | undefined) => void
  gitDiffReloading: (draft: FilesState, tabId: TabId) => void
  gitDiffLoaded: (draft: FilesState, tabId: TabId, path: string, diff: WorkspaceFileDiff) => void
  gitDiffFailed: (draft: FilesState, tabId: TabId, path: string) => void
  gitListScrolled: (draft: FilesState, tabId: TabId, scrollTop: number) => void
  gitDiffModeSelected: (draft: FilesState, tabId: TabId, mode: 'unified' | 'split') => void
  gitRatioChanged: (draft: FilesState, tabId: TabId, ratio: number) => void
  gitPageOpened: (draft: FilesState, tabId: TabId, open: boolean) => void
  gitGroupToggled: (draft: FilesState, tabId: TabId, group: 'changed' | 'untracked') => void
  historyRefsLoading: (draft: FilesState, tabId: TabId) => void
  historyRefsLoaded: (draft: FilesState, tabId: TabId, refs: readonly WorkspaceGitRef[]) => void
  historyRefsFailed: (draft: FilesState, tabId: TabId) => void
  historyLoading: (draft: FilesState, tabId: TabId) => void
  historyLoaded: (draft: FilesState, tabId: TabId, ref: string | undefined, skip: number, epoch: number, page: WorkspaceGitHistory) => void
  historyFailed: (draft: FilesState, tabId: TabId) => void
  historyRefSelected: (draft: FilesState, tabId: TabId, ref: string | undefined) => void
  historyCommitSelected: (draft: FilesState, tabId: TabId, hash: string) => void
  historyDetailLoading: (draft: FilesState, tabId: TabId, hash: string) => void
  historyDetailLoaded: (draft: FilesState, tabId: TabId, hash: string, detail: WorkspaceGitCommitDetail) => void
  historyDetailFailed: (draft: FilesState, tabId: TabId, hash: string) => void
  historyFileSelected: (draft: FilesState, tabId: TabId, path: string) => void
  historyDiffLoading: (draft: FilesState, tabId: TabId, hash: string, path: string) => void
  historyDiffLoaded: (draft: FilesState, tabId: TabId, hash: string, path: string, diff: WorkspaceFileDiff) => void
  historyDiffFailed: (draft: FilesState, tabId: TabId, hash: string, path: string) => void
  historyFilesToggled: (draft: FilesState, tabId: TabId) => void
  historyDiffModeSelected: (draft: FilesState, tabId: TabId, mode: 'unified' | 'split') => void
  historyRatioChanged: (draft: FilesState, tabId: TabId, ratio: number) => void
  historyListScrolled: (draft: FilesState, tabId: TabId, scrollTop: number) => void
  historyPageScrolled: (draft: FilesState, tabId: TabId, hash: string, scrollTop: number) => void
  historyPageOpened: (draft: FilesState, tabId: TabId, open: boolean) => void
  reset: (draft: FilesState, tabId: TabId) => void
  forget: (draft: FilesState, tabId: TabId) => void
}

/**
 * Declare the file tree's store.
 *
 * A factory rather than a shared handle: the registration declares it as an
 * exclusive store, so the framework mints one instance per session.
 * @returns the store handle to declare on the registration.
 */
export function createFilesStore(): EngineStoreHandle<FilesState, FilesActions> {
  return defineStore({
    init: (): FilesState => ({ byTab: {} }),
    actions: {
      autoRefresh: (d, tabId: TabId, enabled: boolean) => { bucket(d, tabId).autoRefresh = enabled },
      /**
       * Seed one tab's tree at its workspace root, with the root expanded.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       * @param root - absolute path of the workspace root.
       */
      start: (d, tabId: TabId, root: string) => {
        d.byTab[tabId] = {
          root, levels: {}, expanded: [root], scrollTop: 0, autoRefresh: true,
          open: [], active: undefined, ratio: DEFAULT_RATIO, pageOpen: false, container: 'files',
          git: {
            status: undefined, loading: false, failure: false, selected: undefined, selectedFrom: undefined,
            scrollTop: 0, diff: undefined, diffMode: 'unified', ratio: DEFAULT_GIT_RATIO, pageOpen: false,
            groups: { changed: true, untracked: true },
          },
          history: {
            refs: undefined, refsLoading: false, refsFailure: false, ref: undefined,
            commits: [], listEpoch: 0, hasMore: false, loading: false, failure: false,
            selected: undefined, file: undefined, filesOpen: true,
            detail: undefined, diff: undefined, diffMode: 'unified',
            listScrollTop: 0, pageScrollTop: 0, ratio: DEFAULT_HISTORY_RATIO, pageOpen: false,
          },
        }
      },
      /**
       * Mark one directory as being listed.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       * @param path - absolute directory path.
       */
      loading: (d, tabId: TabId, path: string) => {
        const state = bucket(d, tabId)
        if (state.levels[path]?.kind !== 'ready') state.levels[path] = { kind: 'loading' }
      },
      /**
       * Record one directory's contents.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       * @param path - absolute directory path.
       * @param level - the listing to show under it.
       */
      loaded: (d, tabId: TabId, path: string, level: DirLevel) => {
        const state = bucket(d, tabId)
        const previous = state.levels[path]
        if (previous?.kind === 'ready') {
          const directories = new Set(level.entries.filter(entry => entry.type === 'directory').map(entry => entry.name))
          for (const entry of previous.level.entries) {
            if (entry.type !== 'directory' || directories.has(entry.name)) continue
            const removed = `${path.replace(/[/\\]+$/, '')}/${entry.name}`
            state.expanded = state.expanded.filter(value => value !== removed && !value.startsWith(`${removed}/`))
            state.levels = Object.fromEntries(Object.entries(state.levels)
              .filter(([key]) => key !== removed && !key.startsWith(`${removed}/`)))
          }
        }
        state.levels[path] = { kind: 'ready', level }
      },
      /**
       * Record why one directory could not be listed.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       * @param path - absolute directory path.
       * @param failure - the settled Remote failure.
       */
      failed: (d, tabId: TabId, path: string, failure: RemoteFailure) => {
        const level = bucket(d, tabId).levels[path]
        bucket(d, tabId).levels[path] = level?.kind === 'ready'
          ? { ...level, failure }
          : { kind: 'failed', failure }
      },
      /**
       * Open a collapsed directory, or collapse an open one.
       *
       * A collapsed level keeps what it loaded, so reopening it draws at once.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       * @param path - absolute directory path.
       */
      toggled: (d, tabId: TabId, path: string) => {
        const state = bucket(d, tabId)
        const at = state.expanded.indexOf(path)
        if (at >= 0) state.expanded.splice(at, 1)
        else state.expanded.push(path)
      },
      /**
       * Record where one tab's body is scrolled to.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       * @param scrollTop - the body's scroll offset, in px.
       */
      scrolled: (d, tabId: TabId, scrollTop: number) => {
        bucket(d, tabId).scrollTop = scrollTop
      },
      /**
       * Open one file in the content column, or show it when it is already
       * open: a row click never opens a second chip for the same path.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       * @param file - the file the tree's row names.
       */
      fileOpened: (d, tabId: TabId, file: OpenFile) => {
        const state = bucket(d, tabId)
        if (!state.open.some(open => open.path === file.path)) state.open = [...state.open, file]
        state.active = file.path
      },
      /**
       * Close one file's chip. Closing the shown file shows its neighbour — the
       * next chip, or the previous one — and closing the last one empties the
       * content column.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       * @param path - absolute path of the file whose chip closed.
       */
      fileClosed: (d, tabId: TabId, path: string) => {
        const state = bucket(d, tabId)
        const at = state.open.findIndex(open => open.path === path)
        if (at < 0) return
        const remaining = state.open.filter(open => open.path !== path)
        state.open = remaining
        if (state.active !== path) return
        state.active = remaining[Math.min(at, remaining.length - 1)]?.path
        if (state.active === undefined) state.pageOpen = false
      },
      /**
       * Show one open file without changing the chip order.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       * @param path - absolute path of the file to show.
       */
      fileActivated: (d, tabId: TabId, path: string) => {
        const state = bucket(d, tabId)
        if (state.open.some(open => open.path === path)) state.active = path
      },
      /**
       * Close every open file except one, which becomes the shown one.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       * @param path - absolute path of the chip that stays open.
       */
      filesClosedExcept: (d, tabId: TabId, path: string) => {
        const state = bucket(d, tabId)
        const kept = state.open.find(open => open.path === path)
        if (kept === undefined) return
        state.open = [kept]
        state.active = kept.path
      },
      /**
       * Close every open file, emptying the content column.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       */
      filesClosedAll: (d, tabId: TabId) => {
        const state = bucket(d, tabId)
        state.open = []
        state.active = undefined
        state.pageOpen = false
      },
      /**
       * Close the files whose chips sit before one chip; that chip and the ones
       * after it keep their order, and the shown file survives unless its own
       * chip went.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       * @param path - absolute path of the chip the close starts after.
       */
      filesClosedBefore: (d, tabId: TabId, path: string) => {
        const state = bucket(d, tabId)
        const at = state.open.findIndex(open => open.path === path)
        if (at <= 0) return
        state.open = state.open.slice(at)
        if (!state.open.some(open => open.path === state.active)) state.active = state.open[0]?.path
      },
      /**
       * Close the files whose chips sit after one chip.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       * @param path - absolute path of the chip the close starts at.
       */
      filesClosedAfter: (d, tabId: TabId, path: string) => {
        const state = bucket(d, tabId)
        const at = state.open.findIndex(open => open.path === path)
        if (at < 0 || at === state.open.length - 1) return
        state.open = state.open.slice(0, at + 1)
        if (!state.open.some(open => open.path === state.active)) state.active = state.open.at(-1)?.path
      },
      /**
       * Record where a divider drag left the two columns.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       * @param ratio - the content column's share, clamped to the draggable range.
       */
      ratioChanged: (d, tabId: TabId, ratio: number) => {
        bucket(d, tabId).ratio = Math.min(MAX_RATIO, Math.max(MIN_RATIO, ratio))
      },
      /**
       * Open or leave the narrow layout's file-preview drill-down. A preview
       * shown in the wide layout keeps both columns.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       * @param open - whether the preview is the one on screen.
       */
      filesPageOpened: (d, tabId: TabId, open: boolean) => {
        bucket(d, tabId).pageOpen = open
      },
      /**
       * Record the activity rail's selected view container.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       * @param container - id of the container the reader selected.
       */
      containerSelected: (d, tabId: TabId, container: WorkbenchContainer) => {
        bucket(d, tabId).container = container
      },
      /**
       * Mark a status read in flight; the read itself is the caller's.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       */
      gitLoading: (d, tabId: TabId) => {
        bucket(d, tabId).git.loading = true
      },
      /**
       * Record a settled status. A status that no longer has the selected path
       * (the file was committed or reverted) drops the comparison with it, and
       * a working directory that stopped being a repository returns the
       * workbench to its files container.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       * @param status - what git answered.
       */
      gitStatusLoaded: (d, tabId: TabId, status: WorkspaceGitStatus) => {
        const state = bucket(d, tabId)
        const git = state.git
        git.loading = false
        git.failure = false
        // The silent refresh repeats this read while the panel is open; an
        // unchanged tree writes nothing, so the list never re-renders under it.
        if (sameGitStatus(git.status, status)) return
        git.status = status
        // A directory outside a repository has no git or history view; an
        // unavailable read keeps the rail so the panel's retry stays reachable.
        if (status.kind === 'not-a-repository' && (state.container === 'git' || state.container === 'history')) {
          state.container = 'files'
        }
        const selected = git.selected
        if (selected === undefined) return
        const entry = status.entries.find(value => value.path === selected)
        if (entry === undefined) {
          git.selected = undefined
          git.selectedFrom = undefined
          git.diff = undefined
          git.pageOpen = false
        } else {
          git.selectedFrom = entry.from
        }
      },
      /**
       * Record a failed status read; the panel offers a retry.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       */
      gitStatusFailed: (d, tabId: TabId) => {
        const git = bucket(d, tabId).git
        git.loading = false
        git.failure = true
      },
      /**
       * Show one changed path and ask for its comparison. Re-selecting the path
       * already shown keeps its settled comparison; a changed rename origin
       * asks again.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       * @param path - the entry's path.
       * @param from - the entry's rename or copy origin, when git reported one.
       */
      gitEntrySelected: (d, tabId: TabId, path: string, from: string | undefined) => {
        const git = bucket(d, tabId).git
        if (git.selected === path && git.selectedFrom === from && git.diff !== undefined && git.diff !== 'failed') return
        git.selected = path
        git.selectedFrom = from
        git.diff = 'loading'
      },
      /**
       * Mark the shown path's comparison as being read again, for a reload
       * that must not keep showing a stale comparison.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       */
      gitDiffReloading: (d, tabId: TabId) => {
        const git = bucket(d, tabId).git
        if (git.selected !== undefined) git.diff = 'loading'
      },
      /**
       * Record where the changed-path list is scrolled to.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       * @param scrollTop - the list's scroll offset, in px.
       */
      gitListScrolled: (d, tabId: TabId, scrollTop: number) => {
        bucket(d, tabId).git.scrollTop = scrollTop
      },
      /**
       * Record one path's comparison; a comparison for a path the panel no
       * longer shows is dropped.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       * @param path - the compared path.
       * @param diff - the comparison.
       */
      gitDiffLoaded: (d, tabId: TabId, path: string, diff: WorkspaceFileDiff) => {
        const git = bucket(d, tabId).git
        if (git.selected !== path) return
        git.diff = diff
      },
      /**
       * Record a failed comparison read for the shown path.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       * @param path - the compared path.
       */
      gitDiffFailed: (d, tabId: TabId, path: string) => {
        const git = bucket(d, tabId).git
        if (git.selected === path) git.diff = 'failed'
      },
      /**
       * Choose how the comparison is laid out.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       * @param mode - the layout the reader picked.
       */
      gitDiffModeSelected: (d, tabId: TabId, mode: 'unified' | 'split') => {
        bucket(d, tabId).git.diffMode = mode
      },
      /**
       * Record where a drag left the git view's two columns.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       * @param ratio - the comparison column's share, clamped to the draggable range.
       */
      gitRatioChanged: (d, tabId: TabId, ratio: number) => {
        bucket(d, tabId).git.ratio = Math.min(MAX_RATIO, Math.max(MIN_RATIO, ratio))
      },
      /**
       * Open or leave the narrow layout's comparison drill-down. A comparison
       * shown in the wide layout keeps both columns.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       * @param open - whether the comparison is the one on screen.
       */
      gitPageOpened: (d, tabId: TabId, open: boolean) => {
        bucket(d, tabId).git.pageOpen = open
      },
      /**
       * Open or fold one changed-path group.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       * @param group - the group whose header was pressed.
       */
      gitGroupToggled: (d, tabId: TabId, group: 'changed' | 'untracked') => {
        const groups = bucket(d, tabId).git.groups
        groups[group] = !groups[group]
      },
      /**
       * Mark a refs read in flight; the read itself is the caller's.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       */
      historyRefsLoading: (d, tabId: TabId) => {
        bucket(d, tabId).history.refsLoading = true
      },
      /**
       * Record the refs the filter offers. A selected ref the repository no
       * longer reports falls back to walking `HEAD`, with its page and
       * selection cleared so the fresh list starts clean.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       * @param refs - what the Host answered.
       */
      historyRefsLoaded: (d, tabId: TabId, refs: readonly WorkspaceGitRef[]) => {
        const history = bucket(d, tabId).history
        history.refsLoading = false
        history.refsFailure = false
        history.refs = refs
        const ref = history.ref
        if (ref === undefined || refs.some(value => value.refname === ref)) return
        history.ref = undefined
        history.failure = false
        resetHistoryList(history)
      },
      /**
       * Record a failed refs read; the filter offers its retry.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       */
      historyRefsFailed: (d, tabId: TabId) => {
        const history = bucket(d, tabId).history
        history.refsLoading = false
        history.refsFailure = true
      },
      /**
       * Mark a history page read in flight; the loaded pages stay on screen.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       */
      historyLoading: (d, tabId: TabId) => {
        bucket(d, tabId).history.loading = true
      },
      /**
       * Record one loaded history page. The first page replaces the list and
       * mints its generation; a later page appends only when it carries that
       * generation and continues the list, so an answer for another ref, a
       * replaced list, or a stale offset is dropped.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       * @param ref - the walked ref, `undefined` for `HEAD`, as the read was asked.
       * @param skip - the commits the request skipped.
       * @param epoch - the read's generation token, minted when it started.
       * @param page - the answered page.
       */
      historyLoaded: (d, tabId: TabId, ref: string | undefined, skip: number, epoch: number, page: WorkspaceGitHistory) => {
        const history = bucket(d, tabId).history
        if (history.ref !== ref) return
        // This settlement owns the read it started: the body drops a read a
        // newer one superseded, so a page that reaches here is the list's most
        // recent read and always ends its loading state.
        history.loading = false
        if (skip === 0) {
          history.commits = page.commits
        } else if (epoch === history.listEpoch && skip === history.commits.length) {
          // The walked ref can move between pages, so a commit that landed
          // since the first page shifts the offset and the next page serves a
          // row the list already holds; that row is dropped rather than drawn
          // twice under one key.
          const known = new Set(history.commits.map(commit => commit.hash))
          history.commits = [...history.commits, ...page.commits.filter(commit => !known.has(commit.hash))]
        } else {
          // A page for a list offset the reader already replaced states
          // nothing about the list; its own loading state is still settled.
          return
        }
        history.hasMore = page.hasMore
        history.failure = false
      },
      /**
       * Record a failed history page read; the loaded pages keep their rows and
       * the list offers its retry.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       */
      historyFailed: (d, tabId: TabId) => {
        const history = bucket(d, tabId).history
        history.loading = false
        history.failure = true
      },
      /**
       * Walk one ref, or `HEAD` when no ref is named. The list restarts and the
       * shown commit page is cleared; a new list picks its first commit.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       * @param ref - the ref to walk, `undefined` for all refs at `HEAD`.
       */
      historyRefSelected: (d, tabId: TabId, ref: string | undefined) => {
        const history = bucket(d, tabId).history
        if (history.ref === ref) return
        history.ref = ref
        resetHistoryList(history)
        // The pick's own page read is about to start, so the list states it.
        history.loading = true
        history.listScrollTop = 0
      },
      /**
       * Show one commit's page and ask for its detail. Re-selecting the commit
       * already shown keeps its settled page unless that page failed.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       * @param hash - the commit to show.
       */
      historyCommitSelected: (d, tabId: TabId, hash: string) => {
        const history = bucket(d, tabId).history
        if (history.selected === hash && history.detail !== undefined && history.detail !== 'failed') return
        history.selected = hash
        history.file = undefined
        history.detail = 'loading'
        history.diff = undefined
        history.pageScrollTop = 0
      },
      /**
       * Mark the shown commit's detail as being read again.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       * @param hash - the commit whose detail is read.
       */
      historyDetailLoading: (d, tabId: TabId, hash: string) => {
        const history = bucket(d, tabId).history
        if (history.selected === hash) history.detail = 'loading'
      },
      /**
       * Record one commit's detail; an answer for a commit the page no longer
       * shows is dropped. A selected file the commit no longer changes is
       * cleared with its comparison.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       * @param hash - the commit the detail describes.
       * @param detail - the commit's message and changed files.
       */
      historyDetailLoaded: (d, tabId: TabId, hash: string, detail: WorkspaceGitCommitDetail) => {
        const history = bucket(d, tabId).history
        if (history.selected !== hash) return
        history.detail = detail
        if (history.file !== undefined && !detail.files.some(file => file.path === history.file)) {
          history.file = undefined
          history.diff = undefined
        }
      },
      /**
       * Record a failed detail read for the shown commit.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       * @param hash - the commit whose detail failed.
       */
      historyDetailFailed: (d, tabId: TabId, hash: string) => {
        const history = bucket(d, tabId).history
        if (history.selected === hash) history.detail = 'failed'
      },
      /**
       * Show one changed file's comparison. Re-selecting the file already shown
       * keeps its settled comparison unless that comparison failed.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       * @param path - the changed file's path.
       */
      historyFileSelected: (d, tabId: TabId, path: string) => {
        const history = bucket(d, tabId).history
        if (history.file === path && history.diff !== undefined && history.diff !== 'failed') return
        history.file = path
        history.diff = 'loading'
      },
      /**
       * Mark the shown file's comparison as being read again.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       * @param hash - the shown commit.
       * @param path - the shown file.
       */
      historyDiffLoading: (d, tabId: TabId, hash: string, path: string) => {
        const history = bucket(d, tabId).history
        if (history.selected === hash && history.file === path) history.diff = 'loading'
      },
      /**
       * Record the shown file's comparison; an answer for another commit or
       * file is dropped.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       * @param hash - the commit the comparison was asked for.
       * @param path - the compared path.
       * @param diff - the comparison.
       */
      historyDiffLoaded: (d, tabId: TabId, hash: string, path: string, diff: WorkspaceFileDiff) => {
        const history = bucket(d, tabId).history
        if (history.selected !== hash || history.file !== path) return
        history.diff = diff
      },
      /**
       * Record a failed comparison read for the shown file.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       * @param hash - the commit the comparison was asked for.
       * @param path - the compared path.
       */
      historyDiffFailed: (d, tabId: TabId, hash: string, path: string) => {
        const history = bucket(d, tabId).history
        if (history.selected === hash && history.file === path) history.diff = 'failed'
      },
      /**
       * Open or fold the selected commit's file section.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       */
      historyFilesToggled: (d, tabId: TabId) => {
        const history = bucket(d, tabId).history
        history.filesOpen = !history.filesOpen
      },
      /**
       * Choose how the commit file comparison is laid out.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       * @param mode - the layout the reader picked.
       */
      historyDiffModeSelected: (d, tabId: TabId, mode: 'unified' | 'split') => {
        bucket(d, tabId).history.diffMode = mode
      },
      /**
       * Record where a drag left the history view's two columns.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       * @param ratio - the commit page's share, clamped to the draggable range.
       */
      historyRatioChanged: (d, tabId: TabId, ratio: number) => {
        bucket(d, tabId).history.ratio = Math.min(MAX_RATIO, Math.max(MIN_RATIO, ratio))
      },
      /**
       * Record where the commit list is scrolled to.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       * @param scrollTop - the list's scroll offset, in px.
       */
      historyListScrolled: (d, tabId: TabId, scrollTop: number) => {
        bucket(d, tabId).history.listScrollTop = scrollTop
      },
      /**
       * Record where the commit page is scrolled to, for the commit it draws.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       * @param hash - the commit the page belongs to.
       * @param scrollTop - the page's scroll offset, in px.
       */
      historyPageScrolled: (d, tabId: TabId, hash: string, scrollTop: number) => {
        const history = bucket(d, tabId).history
        if (history.selected === hash) history.pageScrollTop = scrollTop
      },
      /**
       * Open or leave the narrow layout's commit page drill-down. A selection
       * shown in the wide layout keeps both columns.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       * @param open - whether the page is the one on screen.
       */
      historyPageOpened: (d, tabId: TabId, open: boolean) => {
        bucket(d, tabId).history.pageOpen = open
      },
      /**
       * Collapse every directory back to the root, keeping the loaded levels.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       */
      collapsed: (d, tabId: TabId) => {
        const state = bucket(d, tabId)
        state.expanded = [state.root]
      },
      /**
       * Drop every loaded level, keeping what is expanded.
       *
       * This is the reload gesture's first half: the expanded set says which
       * levels to fetch again.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       */
      reset: (d, tabId: TabId) => {
        bucket(d, tabId).levels = {}
      },
      /**
       * Forget one tab's tree, for a tab record that is gone.
       * @param d - draft state.
       * @param tabId - the tab that went away.
       */
      forget: (d, tabId: TabId) => {
        d.byTab = Object.fromEntries(Object.entries(d.byTab).filter(([id]) => id !== tabId))
      },
    },
  })
}
