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

/** The narrowest share a divider drag may leave the content column. */
export const MIN_RATIO = 0.2

/** The widest share a divider drag may leave the content column. */
export const MAX_RATIO = 0.8

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
  /** Id of the view container the activity rail has selected. */
  container: string
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
  collapsed: (draft: FilesState, tabId: TabId) => void
  containerSelected: (draft: FilesState, tabId: TabId, container: string) => void
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
          open: [], active: undefined, ratio: DEFAULT_RATIO, container: 'files',
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
       * Record the activity rail's selected view container.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       * @param container - id of the container the reader selected.
       */
      containerSelected: (d, tabId: TabId, container: string) => {
        bucket(d, tabId).container = container
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
