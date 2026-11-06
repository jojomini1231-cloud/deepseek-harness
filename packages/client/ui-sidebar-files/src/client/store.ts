/**
 * The files type's view state, in one Slot-standard exclusive store (one
 * instance per Session) with two record sets. `byPane` holds each
 * right-Sidebar pane's tree and navigator: which directories are expanded,
 * what each loaded level contains, and how the navigator is shown, so every
 * file tab of a pane draws the same tree; the face decides when a pane's
 * record is forgotten (`FilesInjected.attach`). `byTab` holds each `files`
 * page's workbench: the files open in its content column, how its columns
 * divide, and its git and history views, from the face's `start` until the
 * tab's signal aborts. Beside it live pure reads shared by the face and the
 * drawings: path keys, where a tab's file sits in the listed tree, and the
 * navigator's geometry.
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import type { RemoteFailure } from '@deepseek-ai/dsh-api-remotes/client'
import type { PaneId, TabId } from '@deepseek-ai/dsh-client-ui-dockkit'
import type { WorkspaceDirectoryEntry } from '@deepseek-ai/dsh-api-workspace-files/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {
  WorkspaceFileDiff, WorkspaceGitCommit, WorkspaceGitCommitDetail, WorkspaceGitHistory, WorkspaceGitRef,
  WorkspaceGitStatus,
} from '@deepseek-ai/dsh-workspace-changes/types'
import { isAbsoluteWorkspacePath, parseFileAddress } from '@deepseek-ai/dsh-util-workspace-path'
import { sameGitRefs, sameGitStatus } from '../git.ts'
import { historyPageChange } from './history.ts'

/** The navigator's width before a pane has a preference, in CSS pixels. */
export const DEFAULT_NAVIGATOR_WIDTH = 260

/** The narrowest navigator, when the row has room for it. */
const NAVIGATOR_MINIMUM = 180
/** What a navigator floating over the row leaves of it uncovered. */
const ROW_REMAINDER = 120
/**
 * The row width from which a preview's navigator takes its width from the
 * body instead of floating over it. Fixed, so resizing the tree never moves
 * the navigator between the two layouts.
 */
export const PUSH_FROM = 560
/** The body width a navigator that takes its width from the body leaves. */
const PREVIEW_MINIMUM = 320
/** The navigator card's left plus right margin in that layout (FilesBody.module.css `.push`). */
const PUSH_MARGINS = 16

/**
 * Fit the navigator to the row it shares with the preview. In a row at least
 * `PUSH_FROM` wide the navigator sits beside the body, so it is at most the
 * row less its card's margins and `PREVIEW_MINIMUM`; in a narrower row it
 * floats over the body and is at most the row less `ROW_REMAINDER`.
 * @param available - the row's width in CSS pixels; `undefined` before it is measured.
 * @param width - the pane's width preference.
 * @returns the resize bounds and the width drawn.
 */
export function navigatorGeometry(available: number | undefined, width: number): {
  readonly minimum: number
  readonly maximum: number
  readonly width: number
} {
  // Unmeasured, the preference is drawn as asked until the row reports its width.
  if (available === undefined) {
    const drawn = Math.max(NAVIGATOR_MINIMUM, width)
    return { minimum: NAVIGATOR_MINIMUM, maximum: drawn, width: drawn }
  }
  const maximum = Math.max(0, available - (available >= PUSH_FROM ? PUSH_MARGINS + PREVIEW_MINIMUM : ROW_REMAINDER))
  const minimum = Math.min(NAVIGATOR_MINIMUM, maximum)
  return { minimum, maximum, width: Math.min(Math.max(minimum, width), maximum) }
}

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

/**
 * What one directory level is doing right now. A `ready` level marked
 * `refreshing` keeps its last listing until the next one settles: the listing
 * in flight, or, once its directory opens again, the first listing there. An
 * entry missing from it is not yet known to be absent. A directory whose
 * listing fails also clears the mark on every level below it, which it does
 * not list.
 */
export type LevelState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly level: DirLevel; readonly failure?: RemoteFailure; readonly refreshing?: true }
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
 * One pane's tree: its root, the levels it has asked for, and what is open.
 *
 * Every path here is absolute: the root is the session's working directory as
 * the Host reports it, and a child is the parent joined with the entry name.
 */
export interface FilesTreeState {
  autoRefresh: boolean
  /** Absolute path of the workspace root this tree is rooted at. */
  root: string
  /** Level state by absolute directory path; a path absent here was never asked for. */
  levels: Record<string, LevelState>
  /** Expanded absolute directory paths, root included. */
  expanded: string[]
}

/** One pane's navigator: whether and how wide it is shown, and its tree once started. */
export interface FilesPaneState {
  /**
   * Whether a preview's navigator is shown; `undefined`, hidden, until the
   * pane's first choice. The `files` page shows its tree regardless.
   */
  open: boolean | undefined
  /** The reader's width preference in CSS pixels; the navigator clamps it to the room it has. */
  width: number
  /** The tree, listed once the navigator is first shown. */
  tree: FilesTreeState | undefined
}

/**
 * One `files` page's workbench: the workspace it reads, the files open in its
 * content column, and its git and history views. The page's tree is its
 * pane's (`FilesPaneState.tree`).
 */
export interface FilesTabState {
  /** Absolute path of the workspace root, as the Host reports the session's working directory. */
  root: string
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
  /** Whether the comparison covers the whole file; false shows only the changed hunks. */
  diffComplete: boolean
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
  /**
   * Full ref name the list walks, such as `refs/heads/dev`; `undefined` walks
   * the repository's `HEAD` across all refs.
   */
  ref: string | undefined
  /**
   * Whether {@link ref} is the reader's own pick. False while the list follows
   * the attached branch, so a refs read moves a defaulted list to the branch
   * that is checked out now; a pick moves only when its ref disappears.
   */
  refPicked: boolean
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
  /** Whether the comparison covers the whole file; false shows only the changed hunks. */
  diffComplete: boolean
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

/** Every pane's navigator and every `files` page's workbench. */
export interface FilesState {
  /** Tree and navigator records, keyed by pane id. */
  byPane: Record<PaneId, FilesPaneState>
  /** Workbench records, keyed by the `files` tab's id. */
  byTab: Record<TabId, FilesTabState>
}

/**
 * The absolute path of one child entry.
 *
 * Joined with `/` whatever the parent's separators: the Host resolves mixed
 * separators, and the tree only needs a stable key.
 * @param parent - absolute path of the listed directory.
 * @param name - the entry's basename.
 * @returns the child's absolute path.
 */
export function childPath(parent: string, name: string): string {
  return `${parent.replace(/[/\\]+$/, '')}/${name}`
}

/** Where a file sits in the listed tree. */
export interface TreeFileLocation {
  /** Listed ancestor directories, outermost first, with the parent each is listed under. */
  readonly ancestors: readonly { readonly parent: string; readonly path: string }[]
  /** The file's tree key, once every level on the way is listed and holds it. */
  readonly current: string | undefined
  /** A level on the way is still being listed, or is listed again and lacks the next name. */
  readonly pending: boolean
}

/**
 * Whether a root is a Windows drive or UNC path, in either separator spelling,
 * where names compare regardless of case.
 * @param root - the tree's root, or a prefix built from it.
 * @returns `true` for a drive letter followed by a separator, or a leading double separator.
 */
function windowsRoot(root: string): boolean {
  const path = root.replace(/\\/g, '/')
  return /^[A-Za-z]:\//.test(path) || path.startsWith('//')
}

/**
 * Walk the listed levels to a workspace-relative file, keeping the listing's
 * spelling of each name; a Windows root also matches names regardless of case.
 * @param tree - the pane's tree.
 * @param relativePath - the file's path under the tree's root, `/`-separated.
 * @returns the ancestors found so far, the file's tree key, and whether a level is pending.
 */
export function locateFile(tree: FilesTreeState, relativePath: string): TreeFileLocation {
  const caseless = windowsRoot(tree.root)
  const parts = relativePath.split('/')
  const ancestors: { parent: string; path: string }[] = []
  let parent = tree.root
  for (const [index, part] of parts.entries()) {
    const level = tree.levels[parent]
    if (level?.kind !== 'ready') return { ancestors, current: undefined, pending: level === undefined || level.kind === 'loading' }
    const type = index === parts.length - 1 ? 'file' : 'directory'
    const candidates = level.level.entries.filter(entry => entry.type === type)
    const entry = candidates.find(candidate => candidate.name === part)
      ?? (caseless ? candidates.find(candidate => candidate.name.toLowerCase() === part.toLowerCase()) : undefined)
    if (entry === undefined) return { ancestors, current: undefined, pending: level.refreshing === true }
    const path = childPath(parent, entry.name)
    if (type === 'directory') ancestors.push({ parent, path })
    parent = path
  }
  return { ancestors, current: parent, pending: false }
}

/**
 * The workspace-relative path of the file a tab shows, when it is a file of
 * this Session under the tree's root; dot segments are not resolved here. An
 * absolute path is under a Windows drive or UNC root regardless of case and
 * separator spelling, and under a POSIX root only with the root's exact case.
 * @param address - the tab's content address.
 * @param sessionId - the Session the tree lists.
 * @param root - the tree's root.
 * @returns the `/`-separated relative path, or `undefined` for anything else.
 */
export function relativeFileOf(address: string, sessionId: SessionId, root: string): string | undefined {
  const file = parseFileAddress(address)
  if (file?.scope !== 'session' || file.sessionId !== sessionId) return undefined
  const path = file.path.replace(/\\/g, '/')
  const normalized = isAbsoluteWorkspacePath(path) ? underRoot(path, root) : path
  if (normalized === undefined || normalized === '' || isAbsoluteWorkspacePath(normalized)) return undefined
  return normalized.split('/').some(part => part === '' || part === '.' || part === '..') ? undefined : normalized
}

/**
 * An absolute `/`-separated path relative to a tree's root.
 * @param path - the absolute path, `/`-separated.
 * @param root - the tree's root, in either separator spelling.
 * @returns the path under the root, or `undefined` outside it.
 */
function underRoot(path: string, root: string): string | undefined {
  const prefix = `${root.replace(/\\/g, '/').replace(/\/+$/, '')}/`
  const head = path.slice(0, prefix.length)
  const caseless = windowsRoot(prefix)
  return (caseless ? head.toLowerCase() === prefix.toLowerCase() : head === prefix) ? path.slice(prefix.length) : undefined
}

/**
 * One pane's record, created by its first write.
 * @param state - the draft.
 * @param paneId - the pane being written.
 * @returns the pane's record.
 */
function pane(state: FilesState, paneId: PaneId): FilesPaneState {
  state.byPane[paneId] ??= { open: undefined, width: DEFAULT_NAVIGATOR_WIDTH, tree: undefined }
  return state.byPane[paneId]
}

/**
 * One pane's tree, which every writer after `start` relies on: the face only
 * dispatches while it holds the pane's records, and `forget` runs as it drops them.
 * @param state - the draft.
 * @param paneId - the pane being written.
 * @returns the pane's tree.
 */
function tree(state: FilesState, paneId: PaneId): FilesTreeState {
  const started = state.byPane[paneId]?.tree
  if (started === undefined) throw new Error(`ui-sidebar-files: no tree for pane "${paneId}"`)
  return started
}

/**
 * One `files` page's workbench, which every workbench writer after
 * `workbenchStarted` relies on: the face only dispatches while the tab's
 * signal is live, and `workbenchForgotten` runs on its abort.
 * @param state - the draft.
 * @param tabId - the tab being written.
 * @returns the tab's workbench.
 */
function workbench(state: FilesState, tabId: TabId): FilesTabState {
  const started = state.byTab[tabId]
  if (started === undefined) throw new Error(`ui-sidebar-files: no workbench for tab "${tabId}"`)
  return started
}

/** The store's write set; tree and navigator actions name their pane, workbench actions their `files` tab. */
type FilesActions = {
  autoRefresh: (draft: FilesState, paneId: PaneId, enabled: boolean) => void
  start: (draft: FilesState, paneId: PaneId, root: string) => void
  loading: (draft: FilesState, paneId: PaneId, path: string) => void
  loaded: (draft: FilesState, paneId: PaneId, path: string, level: DirLevel) => void
  failed: (draft: FilesState, paneId: PaneId, path: string, failure: RemoteFailure) => void
  toggled: (draft: FilesState, paneId: PaneId, path: string) => void
  shown: (draft: FilesState, paneId: PaneId, open: boolean) => void
  resized: (draft: FilesState, paneId: PaneId, width: number) => void
  collapsed: (draft: FilesState, paneId: PaneId) => void
  forget: (draft: FilesState, paneId: PaneId) => void
  workbenchStarted: (draft: FilesState, tabId: TabId, root: string) => void
  fileOpened: (draft: FilesState, tabId: TabId, file: OpenFile) => void
  fileClosed: (draft: FilesState, tabId: TabId, path: string) => void
  fileActivated: (draft: FilesState, tabId: TabId, path: string) => void
  filesClosedExcept: (draft: FilesState, tabId: TabId, path: string) => void
  filesClosedAll: (draft: FilesState, tabId: TabId) => void
  filesClosedBefore: (draft: FilesState, tabId: TabId, path: string) => void
  filesClosedAfter: (draft: FilesState, tabId: TabId, path: string) => void
  ratioChanged: (draft: FilesState, tabId: TabId, ratio: number) => void
  filesPageOpened: (draft: FilesState, tabId: TabId, open: boolean) => void
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
  gitDiffCompleteSelected: (draft: FilesState, tabId: TabId, complete: boolean) => void
  gitRatioChanged: (draft: FilesState, tabId: TabId, ratio: number) => void
  gitPageOpened: (draft: FilesState, tabId: TabId, open: boolean) => void
  gitGroupToggled: (draft: FilesState, tabId: TabId, group: 'changed' | 'untracked') => void
  historyRefsLoading: (draft: FilesState, tabId: TabId) => void
  historyRefsLoaded: (draft: FilesState, tabId: TabId, refs: readonly WorkspaceGitRef[], walked: string | undefined) => void
  historyRefsFailed: (draft: FilesState, tabId: TabId) => void
  historyLoading: (draft: FilesState, tabId: TabId) => void
  historyLoaded: (draft: FilesState, tabId: TabId, ref: string | undefined, skip: number, epoch: number, page: WorkspaceGitHistory) => void
  historyPageRefreshed: (draft: FilesState, tabId: TabId, ref: string | undefined, page: WorkspaceGitHistory) => void
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
  historyDiffCompleteSelected: (draft: FilesState, tabId: TabId, complete: boolean) => void
  historyRatioChanged: (draft: FilesState, tabId: TabId, ratio: number) => void
  historyListScrolled: (draft: FilesState, tabId: TabId, scrollTop: number) => void
  historyPageScrolled: (draft: FilesState, tabId: TabId, hash: string, scrollTop: number) => void
  historyPageOpened: (draft: FilesState, tabId: TabId, open: boolean) => void
  workbenchForgotten: (draft: FilesState, tabId: TabId) => void
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
    init: (): FilesState => ({ byPane: {}, byTab: {} }),
    actions: {
      autoRefresh: (d, paneId: PaneId, enabled: boolean) => { tree(d, paneId).autoRefresh = enabled },
      /**
       * Seed one pane's tree at its workspace root, with the root expanded.
       * @param d - draft state.
       * @param paneId - the pane being drawn.
       * @param root - absolute path of the workspace root.
       */
      start: (d, paneId: PaneId, root: string) => {
        pane(d, paneId).tree = { root, levels: {}, expanded: [root], autoRefresh: true }
      },
      /**
       * Mark one directory as being listed; a listed level keeps its entries and is marked refreshing.
       * @param d - draft state.
       * @param paneId - the pane being drawn.
       * @param path - absolute directory path.
       */
      loading: (d, paneId: PaneId, path: string) => {
        const state = tree(d, paneId)
        const level = state.levels[path]
        if (level?.kind !== 'ready') state.levels[path] = { kind: 'loading' }
        else if (level.refreshing !== true) state.levels[path] = { ...level, refreshing: true }
      },
      /**
       * Record one directory's contents.
       * @param d - draft state.
       * @param paneId - the pane being drawn.
       * @param path - absolute directory path.
       * @param level - the listing to show under it.
       */
      loaded: (d, paneId: PaneId, path: string, level: DirLevel) => {
        const state = tree(d, paneId)
        const previous = state.levels[path]
        if (previous?.kind === 'ready') {
          const directories = new Set(level.entries.filter(entry => entry.type === 'directory').map(entry => entry.name))
          for (const entry of previous.level.entries) {
            if (entry.type !== 'directory' || directories.has(entry.name)) continue
            const removed = childPath(path, entry.name)
            state.expanded = state.expanded.filter(value => value !== removed && !value.startsWith(`${removed}/`))
            state.levels = Object.fromEntries(Object.entries(state.levels)
              .filter(([key]) => key !== removed && !key.startsWith(`${removed}/`)))
          }
        }
        state.levels[path] = { kind: 'ready', level }
      },
      /**
       * Record why one directory could not be listed, and end the refresh of the levels below it.
       * @param d - draft state.
       * @param paneId - the pane being drawn.
       * @param path - absolute directory path.
       * @param failure - the settled Remote failure.
       */
      failed: (d, paneId: PaneId, path: string, failure: RemoteFailure) => {
        const state = tree(d, paneId)
        const level = state.levels[path]
        state.levels[path] = level?.kind === 'ready'
          ? { kind: 'ready', level: level.level, failure }
          : { kind: 'failed', failure }
        // A directory that failed to list lists none below it, so their kept listings are the latest known.
        const below = `${path.replace(/[/\\]+$/, '')}/`
        for (const [key, kept] of Object.entries(state.levels)) {
          if (!key.startsWith(below) || kept.kind !== 'ready' || kept.refreshing !== true) continue
          state.levels[key] = kept.failure === undefined
            ? { kind: 'ready', level: kept.level }
            : { kind: 'ready', level: kept.level, failure: kept.failure }
        }
      },
      /**
       * Open a collapsed directory, or collapse an open one.
       *
       * A collapsed level keeps what it loaded, so reopening it draws at once.
       * @param d - draft state.
       * @param paneId - the pane being drawn.
       * @param path - absolute directory path.
       */
      toggled: (d, paneId: PaneId, path: string) => {
        const state = tree(d, paneId)
        const at = state.expanded.indexOf(path)
        if (at >= 0) state.expanded.splice(at, 1)
        else state.expanded.push(path)
      },
      /**
       * Show or hide one pane's navigator.
       * @param d - draft state.
       * @param paneId - the pane being drawn.
       * @param open - whether the navigator is shown.
       */
      shown: (d, paneId: PaneId, open: boolean) => { pane(d, paneId).open = open },
      /**
       * Record one pane's navigator width preference.
       * @param d - draft state.
       * @param paneId - the pane being drawn.
       * @param width - the preferred width, in CSS pixels.
       */
      resized: (d, paneId: PaneId, width: number) => { pane(d, paneId).width = width },
      /**
       * Collapse every directory of one pane's tree back to the root, keeping
       * the loaded levels, so reopening one draws at once.
       * @param d - draft state.
       * @param paneId - the pane being drawn.
       */
      collapsed: (d, paneId: PaneId) => {
        const state = tree(d, paneId)
        state.expanded = [state.root]
      },
      /**
       * Forget one pane's navigator and tree.
       * @param d - draft state.
       * @param paneId - the pane whose records go.
       */
      forget: (d, paneId: PaneId) => {
        d.byPane = Object.fromEntries(Object.entries(d.byPane).filter(([id]) => id !== paneId))
      },
      /**
       * Seed one `files` page's workbench at its workspace root, with nothing
       * open and the files view selected.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       * @param root - absolute path of the workspace root.
       */
      workbenchStarted: (d, tabId: TabId, root: string) => {
        d.byTab[tabId] = {
          root, open: [], active: undefined, ratio: DEFAULT_RATIO, pageOpen: false, container: 'files',
          git: {
            status: undefined, loading: false, failure: false, selected: undefined, selectedFrom: undefined,
            scrollTop: 0, diff: undefined, diffMode: 'unified', diffComplete: false, ratio: DEFAULT_GIT_RATIO, pageOpen: false,
            groups: { changed: true, untracked: true },
          },
          history: {
            refs: undefined, refsLoading: false, refsFailure: false, ref: undefined, refPicked: false,
            commits: [], listEpoch: 0, hasMore: false, loading: false, failure: false,
            selected: undefined, file: undefined, filesOpen: true,
            detail: undefined, diff: undefined, diffMode: 'unified', diffComplete: false,
            listScrollTop: 0, pageScrollTop: 0, ratio: DEFAULT_HISTORY_RATIO, pageOpen: false,
          },
        }
      },
      /**
       * Open one file in the content column, or show it when it is already
       * open: a row click never opens a second chip for the same path.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       * @param file - the file the tree's row names.
       */
      fileOpened: (d, tabId: TabId, file: OpenFile) => {
        const state = workbench(d, tabId)
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
        const state = workbench(d, tabId)
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
        const state = workbench(d, tabId)
        if (state.open.some(open => open.path === path)) state.active = path
      },
      /**
       * Close every open file except one, which becomes the shown one.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       * @param path - absolute path of the chip that stays open.
       */
      filesClosedExcept: (d, tabId: TabId, path: string) => {
        const state = workbench(d, tabId)
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
        const state = workbench(d, tabId)
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
        const state = workbench(d, tabId)
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
        const state = workbench(d, tabId)
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
        workbench(d, tabId).ratio = Math.min(MAX_RATIO, Math.max(MIN_RATIO, ratio))
      },
      /**
       * Open or leave the narrow layout's file-preview drill-down. A preview
       * shown in the wide layout keeps both columns.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       * @param open - whether the preview is the one on screen.
       */
      filesPageOpened: (d, tabId: TabId, open: boolean) => {
        workbench(d, tabId).pageOpen = open
      },
      /**
       * Record the activity rail's selected view container.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       * @param container - id of the container the reader selected.
       */
      containerSelected: (d, tabId: TabId, container: WorkbenchContainer) => {
        workbench(d, tabId).container = container
      },
      /**
       * Mark a status read in flight; the read itself is the caller's.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       */
      gitLoading: (d, tabId: TabId) => {
        workbench(d, tabId).git.loading = true
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
        const state = workbench(d, tabId)
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
        const git = workbench(d, tabId).git
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
        const git = workbench(d, tabId).git
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
        const git = workbench(d, tabId).git
        if (git.selected !== undefined) git.diff = 'loading'
      },
      /**
       * Record where the changed-path list is scrolled to.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       * @param scrollTop - the list's scroll offset, in px.
       */
      gitListScrolled: (d, tabId: TabId, scrollTop: number) => {
        workbench(d, tabId).git.scrollTop = scrollTop
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
        const git = workbench(d, tabId).git
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
        const git = workbench(d, tabId).git
        if (git.selected === path) git.diff = 'failed'
      },
      /**
       * Choose how the comparison is laid out.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       * @param mode - the layout the reader picked.
       */
      gitDiffModeSelected: (d, tabId: TabId, mode: 'unified' | 'split') => {
        workbench(d, tabId).git.diffMode = mode
      },
      /**
       * Choose how much of the compared file the comparison covers.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       * @param complete - whether the whole file is drawn.
       */
      gitDiffCompleteSelected: (d, tabId: TabId, complete: boolean) => {
        workbench(d, tabId).git.diffComplete = complete
      },
      /**
       * Record where a drag left the git view's two columns.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       * @param ratio - the comparison column's share, clamped to the draggable range.
       */
      gitRatioChanged: (d, tabId: TabId, ratio: number) => {
        workbench(d, tabId).git.ratio = Math.min(MAX_RATIO, Math.max(MIN_RATIO, ratio))
      },
      /**
       * Open or leave the narrow layout's comparison drill-down. A comparison
       * shown in the wide layout keeps both columns.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       * @param open - whether the comparison is the one on screen.
       */
      gitPageOpened: (d, tabId: TabId, open: boolean) => {
        workbench(d, tabId).git.pageOpen = open
      },
      /**
       * Open or fold one changed-path group.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       * @param group - the group whose header was pressed.
       */
      gitGroupToggled: (d, tabId: TabId, group: 'changed' | 'untracked') => {
        const groups = workbench(d, tabId).git.groups
        groups[group] = !groups[group]
      },
      /**
       * Mark a refs read in flight; the read itself is the caller's.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       */
      historyRefsLoading: (d, tabId: TabId) => {
        workbench(d, tabId).history.refsLoading = true
      },
      /**
       * Record the refs the filter offers and the ref the list walks after this
       * answer. A changed walk restarts the list, with its page and selection
       * cleared so the fresh history starts clean; an unchanged one keeps its
       * pages and any read still in flight. An answer that repeats the drawn
       * refs writes nothing, so the quiet reread never re-renders the rows.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       * @param refs - what the Host answered.
       * @param walked - the ref the list walks now, `undefined` for all refs at `HEAD`.
       */
      historyRefsLoaded: (d, tabId: TabId, refs: readonly WorkspaceGitRef[], walked: string | undefined) => {
        const history = workbench(d, tabId).history
        history.refsLoading = false
        history.refsFailure = false
        if (history.ref === walked && sameGitRefs(history.refs, refs)) return
        history.refs = refs
        if (history.ref === walked) return
        history.ref = walked
        resetHistoryList(history)
      },
      /**
       * Record a failed refs read; the filter offers its retry.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       */
      historyRefsFailed: (d, tabId: TabId) => {
        const history = workbench(d, tabId).history
        history.refsLoading = false
        history.refsFailure = true
      },
      /**
       * Mark a history page read in flight; the loaded pages stay on screen.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       */
      historyLoading: (d, tabId: TabId) => {
        workbench(d, tabId).history.loading = true
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
        const history = workbench(d, tabId).history
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
       * Apply a quiet reread of the walked ref's first page: commits newer than
       * the loaded list are prepended above it, keeping the loaded pages, the
       * shown commit, and its page; a rewritten tip replaces the list. The
       * read succeeded, so it also clears a failed reread's banner; an answer
       * for a walk the reader has left writes nothing.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       * @param ref - the walked ref the read asked for, `undefined` for all refs.
       * @param page - the answered first page.
       */
      historyPageRefreshed: (d, tabId: TabId, ref: string | undefined, page: WorkspaceGitHistory) => {
        const history = workbench(d, tabId).history
        if (history.ref !== ref) return
        history.failure = false
        const change = historyPageChange(history.commits, page.commits)
        if (change.kind === 'unchanged') return
        history.listEpoch += 1
        if (change.kind === 'prepended') history.commits = [...change.commits, ...history.commits]
        else {
          history.commits = page.commits
          history.hasMore = page.hasMore
        }
      },
      /**
       * Record a failed history page read; the loaded pages keep their rows and
       * the list offers its retry.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       */
      historyFailed: (d, tabId: TabId) => {
        const history = workbench(d, tabId).history
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
        const history = workbench(d, tabId).history
        if (history.ref === ref) return
        history.ref = ref
        // The pick pins the scope: a refs read keeps it while the repository
        // reports it, rather than following the branch that is checked out.
        history.refPicked = true
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
        const history = workbench(d, tabId).history
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
        const history = workbench(d, tabId).history
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
        const history = workbench(d, tabId).history
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
        const history = workbench(d, tabId).history
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
        const history = workbench(d, tabId).history
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
        const history = workbench(d, tabId).history
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
        const history = workbench(d, tabId).history
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
        const history = workbench(d, tabId).history
        if (history.selected === hash && history.file === path) history.diff = 'failed'
      },
      /**
       * Open or fold the selected commit's file section.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       */
      historyFilesToggled: (d, tabId: TabId) => {
        const history = workbench(d, tabId).history
        history.filesOpen = !history.filesOpen
      },
      /**
       * Choose how the commit file comparison is laid out.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       * @param mode - the layout the reader picked.
       */
      historyDiffModeSelected: (d, tabId: TabId, mode: 'unified' | 'split') => {
        workbench(d, tabId).history.diffMode = mode
      },
      /**
       * Choose how much of the compared commit file the comparison covers.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       * @param complete - whether the whole file is drawn.
       */
      historyDiffCompleteSelected: (d, tabId: TabId, complete: boolean) => {
        workbench(d, tabId).history.diffComplete = complete
      },
      /**
       * Record where a drag left the history view's two columns.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       * @param ratio - the commit page's share, clamped to the draggable range.
       */
      historyRatioChanged: (d, tabId: TabId, ratio: number) => {
        workbench(d, tabId).history.ratio = Math.min(MAX_RATIO, Math.max(MIN_RATIO, ratio))
      },
      /**
       * Record where the commit list is scrolled to.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       * @param scrollTop - the list's scroll offset, in px.
       */
      historyListScrolled: (d, tabId: TabId, scrollTop: number) => {
        workbench(d, tabId).history.listScrollTop = scrollTop
      },
      /**
       * Record where the commit page is scrolled to, for the commit it draws.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       * @param hash - the commit the page belongs to.
       * @param scrollTop - the page's scroll offset, in px.
       */
      historyPageScrolled: (d, tabId: TabId, hash: string, scrollTop: number) => {
        const history = workbench(d, tabId).history
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
        workbench(d, tabId).history.pageOpen = open
      },
      /**
       * Forget one `files` page's workbench, for a tab record that is gone.
       * @param d - draft state.
       * @param tabId - the tab that went away.
       */
      workbenchForgotten: (d, tabId: TabId) => {
        d.byTab = Object.fromEntries(Object.entries(d.byTab).filter(([id]) => id !== tabId))
      },
    },
  })
}

/** One Session's live instance of the tree's store, as the face reads and writes it. */
export type FilesStoreInstance = ReturnType<ReturnType<typeof createFilesStore>['create']>
