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
  /** The tree row a reveal asked for, with a token that changes on every request. */
  revealed: { readonly path: string; readonly token: number } | undefined
  /** The content column's share of the workbench, between `MIN_RATIO` and `MAX_RATIO`. */
  ratio: number
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

/**
 * The directories between a tree's root and one path, outermost first.
 *
 * Levels are keyed the way the tree joins them (`childPath`: the root's own
 * separators kept, every child appended with `/`), so a Windows root's reveal
 * names the same keys its listing wrote. The root itself is never included: it
 * is always expanded, and a path outside the root — or the root's own row — has
 * no ancestor to reveal.
 * @param root - the tree's absolute root.
 * @param path - absolute path of a file or directory under it.
 * @returns each ancestor directory, from the root's first child down to the path's parent.
 */
export function ancestorDirectories(root: string, path: string): string[] {
  const trimmed = root.replace(/[/\\]+$/, '')
  if (!path.startsWith(`${trimmed}/`) && !path.startsWith(`${trimmed}\\`)) return []
  const segments = path.slice(trimmed.length + 1).split(/[/\\]+/).filter(segment => segment !== '')
  return segments.slice(0, -1).map((_, index) => `${trimmed}/${segments.slice(0, index + 1).join('/')}`)
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
  revealed: (draft: FilesState, tabId: TabId, path: string) => void
  ratioChanged: (draft: FilesState, tabId: TabId, ratio: number) => void
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
          open: [], active: undefined, revealed: undefined, ratio: DEFAULT_RATIO,
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
       * Expand one file's ancestor directories and remember it as the path the
       * tree should show, so the body can scroll its row into view.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       * @param path - absolute path of the file to show in the tree.
       */
      revealed: (d, tabId: TabId, path: string) => {
        const state = bucket(d, tabId)
        for (const directory of ancestorDirectories(state.root, path)) {
          if (!state.expanded.includes(directory)) state.expanded.push(directory)
        }
        // The token moves even for a path revealed before, so a reader asking
        // again gets the row shown again rather than an unchanged value.
        state.revealed = { path, token: (state.revealed?.token ?? 0) + 1 }
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
