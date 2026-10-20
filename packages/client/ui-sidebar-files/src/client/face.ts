/**
 * The tree's asynchronous half: listing directories into the store and reading
 * the git view's two working-tree routes.
 *
 * The component never awaits anything. It calls `start` / `refresh` / `toggle`, and
 * this face performs the listing and writes the outcome through the store's own
 * actions — the Slot-standard `inject` shape, so the session id is resolved by
 * the framework and the write set stays the store's. The git reads validate
 * their wire payloads before the body writes them to the same store.
 *
 * The listing itself is bound here to the Client Remote face: the tree keys
 * every level by absolute path and hands the endpoint that same absolute path;
 * the endpoint answers with the directory's workspace-relative path as well,
 * which the tree has no use for and drops.
 *
 * One level has one listing in force: asking for a level again — the reload
 * gesture, a directory reopened after a reset — retires the listing still in
 * flight for it, whose settlement then writes nothing. Cleanup rides the owner's
 * `signal`: a request is not made for a record that already ended, and when the
 * record goes away the bucket and the tab's listing bookkeeping are forgotten,
 * so no later settlement writes to it.
 *
 * The face also owns each open chip's preview lifetime: a controller per chip,
 * combined with the tab's signal, so closing a chip releases its preview while
 * its siblings keep theirs, and a remounted body hands the preview the same
 * signal its state is keyed to.
 */
import type { ClientRemote, RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import type { BoundActions } from '@deepseek-ai/dsh-client-store'
import type { TabId } from '@deepseek-ai/dsh-client-ui-dockkit'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { DirLevel, createFilesStore } from './store.ts'
import type {
  WorkspaceFileDiff, WorkspaceGitCommitDetail, WorkspaceGitCommitDiffRequest, WorkspaceGitDiffRequest,
  WorkspaceGitHistory, WorkspaceGitHistoryRequest, WorkspaceGitRef, WorkspaceGitStatus,
} from '@deepseek-ai/dsh-workspace-changes/types'
import {
  gitCommitDiffUrl, gitCommitUrl, gitDiffUrl, gitHistoryUrl, gitRefsUrl, gitStatusUrl,
  isFileDiff, isGitCommitDetail, isGitHistory, isGitRefs, isGitStatus,
} from '../git.ts'
import type { WorkspaceFileWatchFrame } from '@deepseek-ai/dsh-api-workspace-files/types'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { DirectoryNode } from './directory-node.ts'

/**
 * Observe one directory without recursively watching its descendants.
 * @param sessionId - Session owning the directory tree.
 * @param path - absolute directory path.
 * @param signal - node lifetime.
 * @returns readiness and invalidation notifications.
 */
export type WatchWorkspaceDirectory = (sessionId: SessionId, path: string, signal: AbortSignal) => AsyncIterable<'ready' | 'change'>

/**
 * Bind directory observation to the Remote stream supervisor.
 * @param remote - Client Remote with workspace file streams.
 * @returns a watcher that awaits stream disposal when its node ends.
 */
export function createWatch(remote: ClientRemote): WatchWorkspaceDirectory {
  return async function* (sessionId, path, signal) {
    const aborted = (): boolean => signal.aborted
    if (aborted()) return
    const stream = remote.$stream<WorkspaceFileWatchFrame>({
      name: `directory ${path}`,
      open: lifetime => remote.workspaceFiles.changes(sessionId, path, lifetime),
      ended: () => new Error(`Directory watch ended: ${path}`),
    })
    const abort = (): void => { void stream.dispose() }
    signal.addEventListener('abort', abort, { once: true })
    try {
      for await (const item of stream) {
        if (aborted()) return
        if (item.value.kind === 'ready') item.accept()
        yield item.value.kind
      }
    } finally {
      signal.removeEventListener('abort', abort)
      await stream.dispose()
    }
  }
}

/**
 * One directory listing, bound to a Remote face.
 *
 * The session travels with the call because the endpoint resolves the workspace
 * root from it: the same path means different directories in different sessions.
 * A Remote call does not reject — the result carries the failure.
 */
export type ListWorkspaceDirectory = (
  sessionId: SessionId,
  path: string,
  signal: AbortSignal,
) => Promise<RemoteResult<DirLevel>>

/**
 * The slice of the Client Remote face this package calls: the `workspaceFiles`
 * namespace's `list`, exactly as the Host's generated client declares it.
 */
export type WorkspaceFilesListRemote = {
  readonly workspaceFiles: Pick<ClientRemote['workspaceFiles'], 'list'>
}

/**
 * Bind the listing to one Remote face, keeping only what the tree stores.
 * @param remote - the Client Remote face carrying the `workspaceFiles` namespace.
 * @returns the listing the tree's face performs.
 */
export function createList(remote: WorkspaceFilesListRemote): ListWorkspaceDirectory {
  return async (sessionId, path, signal) => {
    const result = await remote.workspaceFiles.list(sessionId, path, signal)
    if (!result.ok) return result
    return { ok: true, value: { entries: result.value.entries, truncated: result.value.truncated } }
  }
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

/** The tree's injected business face, as the body receives it. */
export interface FilesInjected {
  /** Refresh the open directory tree. @param tabId - owning tab. */
  readonly refresh: (tabId: TabId) => void
  /** Control automatic rereads without closing watches. @param tabId - owning tab. @param enabled - automatic-refresh setting. */
  readonly setAutoRefresh: (tabId: TabId, enabled: boolean) => void
  /**
   * Seed this tab's tree and list its root.
   * @param tabId - the tab being drawn.
   * @param root - absolute path of the workspace root.
   * @param signal - the tab record's lifetime.
   */
  readonly start: (tabId: TabId, root: string, signal: AbortSignal) => void
  /**
   * List one directory into the store.
   * @param tabId - the tab being drawn.
   * @param path - absolute directory path.
   * @param signal - the tab record's lifetime.
   */
  readonly load: (tabId: TabId, path: string, signal: AbortSignal) => void
  /**
   * Open or collapse one directory, retaining intent during ancestor restoration.
   * @param tabId - the tab being drawn.
   * @param parentPath - the listed parent directory's exact tree key.
   * @param path - absolute directory path.
   * @param expanded - current expansion preferences, including descendants to restore.
   * @param signal - the tab record's lifetime.
   */
  readonly toggle: (tabId: TabId, parentPath: string, path: string, expanded: readonly string[], signal: AbortSignal) => void
  /**
   * The lifetime signal of one open chip's preview, minted on first use and
   * stable for the chip until it closes: the tab record's signal combined with
   * a controller the face holds, so a remounted body receives the same signal
   * the preview's state is already keyed to.
   * @param tabId - the tab being drawn.
   * @param path - absolute path of the open file.
   * @param signal - the tab record's lifetime.
   * @returns the chip's preview lifetime.
   */
  readonly chipSignal: (tabId: TabId, path: string, signal: AbortSignal) => AbortSignal
  /**
   * End the preview lifetimes of chips their store actions just closed. The
   * body computes the closed set from the open chips it drew; paths without a
   * lifetime are ignored, so a close that changes nothing ends nothing.
   * @param tabId - the tab being drawn.
   * @param paths - absolute paths of the files whose chips closed.
   */
  readonly chipsClosed: (tabId: TabId, paths: readonly string[]) => void
  /**
   * Collapse every open directory back to the root, ending their listings and
   * watches; the loaded levels stay, so reopening one is instant.
   * @param tabId - the tab being drawn.
   * @param signal - the tab record's lifetime.
   */
  readonly collapseAll: (tabId: TabId, signal: AbortSignal) => void
  /**
   * Read the working tree's git state.
   * @param tabId - the tab asking.
   * @param cwd - the Session working directory.
   * @param signal - the request's cancellation.
   * @returns the state, or undefined when the Host refused or answered with something else.
   */
  readonly gitStatus: (tabId: TabId, cwd: string, signal: AbortSignal) => Promise<GitRead<WorkspaceGitStatus>>
  /**
   * Read one changed path's comparison with its `HEAD` content.
   * @param tabId - the tab asking.
   * @param cwd - the Session working directory.
   * @param request - the changed path and, for a rename or copy, its original path.
   * @param signal - the request's cancellation.
   * @returns the comparison, or undefined when the Host refused, has none, or answered for another path.
   */
  readonly gitDiff: (
    tabId: TabId, cwd: string, request: WorkspaceGitDiffRequest, signal: AbortSignal,
  ) => Promise<GitRead<WorkspaceFileDiff>>
  /**
   * Read the refs the history filter offers.
   * @param tabId - the tab asking.
   * @param cwd - the Session working directory.
   * @param signal - the request's cancellation.
   * @returns the refs, or undefined when the Host refused or answered with something else.
   */
  readonly historyRefs: (tabId: TabId, cwd: string, signal: AbortSignal) => Promise<GitRead<readonly WorkspaceGitRef[]>>
  /**
   * Read one page of a ref's history.
   * @param tabId - the tab asking.
   * @param cwd - the Session working directory.
   * @param request - the ref to walk, the commits to skip, and the page size.
   * @param signal - the request's cancellation.
   * @returns the page, or undefined when the Host refused or answered with something else.
   */
  readonly history: (
    tabId: TabId, cwd: string, request: WorkspaceGitHistoryRequest, signal: AbortSignal,
  ) => Promise<GitRead<WorkspaceGitHistory>>
  /**
   * Read one commit's message and changed files.
   * @param tabId - the tab asking.
   * @param cwd - the Session working directory.
   * @param hash - the commit to read.
   * @param signal - the request's cancellation.
   * @returns the detail, or undefined when the Host refused or answered for another commit.
   */
  readonly commit: (
    tabId: TabId, cwd: string, hash: string, signal: AbortSignal,
  ) => Promise<GitRead<WorkspaceGitCommitDetail>>
  /**
   * Read one commit file's comparison with the commit's first parent.
   * @param tabId - the tab asking.
   * @param cwd - the Session working directory.
   * @param request - the commit, the path to compare, and a rename origin.
   * @param signal - the request's cancellation.
   * @returns the comparison, or undefined when the Host refused, has none, or answered for another path.
   */
  readonly commitDiff: (
    tabId: TabId, cwd: string, request: WorkspaceGitCommitDiffRequest, signal: AbortSignal,
  ) => Promise<GitRead<WorkspaceFileDiff>>
}

/** One settled git read and whether a newer read of its kind has started since. */
export interface GitRead<T> {
  /** The Host's answer, or undefined when it refused or the read failed. */
  readonly value: T | undefined
  /** False when the tab started a newer read of the same kind before this one settled. */
  readonly current: boolean
}

/**
 * Bind the tree's face to one directory listing.
 * @param list - the bound `workspaceFiles.list` call.
 * @param watch - target-scoped directory observation.
 * @returns the Slot `inject` factory: session and bound actions in, face out.
 */
export function filesFace(
  list: ListWorkspaceDirectory,
  watch: WatchWorkspaceDirectory,
): (sessionId: SessionId, actions: BoundActions<ReturnType<typeof createFilesStore>>) => FilesInjected {
  return (
    sessionId: SessionId,
    actions: BoundActions<ReturnType<typeof createFilesStore>>,
  ): FilesInjected => {
    /** Per tab, per absolute path: the listing generation a settlement must match; the latest request wins. */
    const generations = new Map<TabId, Map<string, number>>()
    /**
     * Per tab, per read name (`git.status`, `history.list`, ...): the token of
     * the latest read, so a slow answer never overwrites a newer one. The token
     * is the read's own object rather than a counter: a tab id reused after
     * `forget` starts a new tab, and its first read must not match a settlement
     * still in flight from the one before it.
     */
    const readsByTab = new Map<TabId, Map<string, object>>()
    const roots = new Map<TabId, DirectoryNode>()
    // One controller per open chip, owned here because the body unmounts while
    // the tab lives: the preview's first read arms its cleanup on this signal,
    // so the signal must stay identical across body remounts.
    const chipSignals = new Map<TabId, Map<string, { readonly controller: AbortController; readonly signal: AbortSignal }>>()
    const nextGeneration = (tabId: TabId, path: string): number => {
      const byPath = generations.get(tabId) ?? new Map<string, number>()
      generations.set(tabId, byPath)
      const generation = (byPath.get(path) ?? 0) + 1
      byPath.set(path, generation)
      return generation
    }
    const nextRead = (tabId: TabId, kind: string): object => {
      const reads = readsByTab.get(tabId) ?? new Map<string, object>()
      readsByTab.set(tabId, reads)
      const token = {}
      reads.set(kind, token)
      return token
    }
    const currentRead = (tabId: TabId, kind: string, token: object): boolean =>
      readsByTab.get(tabId)?.get(kind) === token
    const load = async (tabId: TabId, path: string, signal: AbortSignal): Promise<DirLevel | undefined> => {
      if (signal.aborted) return
      const generation = nextGeneration(tabId, path)
      actions.loading(tabId, path)
      return list(sessionId, path, signal).then((result) => {
        // A newer listing of this level was asked for since, or the record is
        // gone and its bookkeeping with it: nothing left for this one to write.
        if (signal.aborted || generations.get(tabId)?.get(path) !== generation) return
        if (result.ok) actions.loaded(tabId, path, result.value)
        else actions.failed(tabId, path, result.error)
        return result.ok ? result.value : undefined
      })
    }
    /**
     * Fetch one authenticated route and accept its decoded JSON through a
     * validator; a refusal, a malformed answer, an interruption, or a failed
     * read is `undefined` for the caller's failed state.
     */
    const readJson = async <T>(
      url: string, signal: AbortSignal, accept: (value: unknown) => value is T,
    ): Promise<T | undefined> => {
      try {
        const response = await fetch(url, { signal })
        if (!response.ok) return undefined
        const value: unknown = await response.json()
        return accept(value) ? value : undefined
      } catch {
        // A refused or interrupted read is the panel's failed state, not a throw.
        return undefined
      }
    }
    const readGitStatus = (cwd: string, signal: AbortSignal): Promise<WorkspaceGitStatus | undefined> =>
      readJson(gitStatusUrl(sessionId, cwd), signal, isGitStatus)
    const readGitDiff = async (
      cwd: string, request: WorkspaceGitDiffRequest, signal: AbortSignal,
    ): Promise<WorkspaceFileDiff | undefined> => {
      const diff = await readJson(gitDiffUrl(sessionId, cwd, request), signal, isFileDiff)
      // The answer must describe the path that was asked for, or it is not this
      // selection's comparison.
      return diff !== undefined && diff.path === request.path ? diff : undefined
    }
    const readHistoryRefs = (cwd: string, signal: AbortSignal): Promise<readonly WorkspaceGitRef[] | undefined> =>
      readJson(gitRefsUrl(sessionId, cwd), signal, isGitRefs)
    const readHistory = (
      cwd: string, request: WorkspaceGitHistoryRequest, signal: AbortSignal,
    ): Promise<WorkspaceGitHistory | undefined> =>
      readJson(gitHistoryUrl(sessionId, cwd, request), signal, isGitHistory)
    const readCommit = async (
      cwd: string, hash: string, signal: AbortSignal,
    ): Promise<WorkspaceGitCommitDetail | undefined> => {
      const detail = await readJson(gitCommitUrl(sessionId, cwd, hash), signal, isGitCommitDetail)
      // The answer must describe the commit that was asked for, or it is not
      // this selection's page. The route accepts an abbreviated id and always
      // answers the full hash, so the request names a prefix of the answer.
      return detail !== undefined && detail.commit.hash.startsWith(hash) ? detail : undefined
    }
    const readCommitDiff = async (
      cwd: string, request: WorkspaceGitCommitDiffRequest, signal: AbortSignal,
    ): Promise<WorkspaceFileDiff | undefined> => {
      const diff = await readJson(gitCommitDiffUrl(sessionId, cwd, request), signal, isFileDiff)
      // The answer must describe the path that was asked for, or it is not this
      // file's comparison.
      return diff !== undefined && diff.path === request.path ? diff : undefined
    }
    return {
      refresh: (tabId) => { void roots.get(tabId)?.refreshTree() },
      setAutoRefresh: (tabId, enabled) => {
        actions.autoRefresh(tabId, enabled)
        roots.get(tabId)?.setAutomatic(enabled)
      },
      start(tabId, root, signal) {
        actions.start(tabId, root)
        signal.addEventListener('abort', () => {
          void roots.get(tabId)?.close()
          roots.delete(tabId)
          generations.delete(tabId)
          readsByTab.delete(tabId)
          const chips = chipSignals.get(tabId)
          chipSignals.delete(tabId)
          for (const { controller } of chips?.values() ?? []) controller.abort()
          actions.forget(tabId)
        }, { once: true })
        roots.set(tabId, new DirectoryNode(root,
          (path, lifetime) => load(tabId, path, lifetime),
          (path, lifetime) => watch(sessionId, path, lifetime),
          (path, error) => {
            if (!signal.aborted) actions.failed(tabId, path, new RemoteError('gateway/internal', error instanceof Error ? error.message : String(error), {}))
          }, signal,
        ).open())
      },
      load: (tabId, path, signal) => { void load(tabId, path, signal) },
      chipSignal: (tabId, path, signal) => {
        const chips = chipSignals.get(tabId) ?? new Map<string, { controller: AbortController; signal: AbortSignal }>()
        chipSignals.set(tabId, chips)
        const held = chips.get(path)
        if (held !== undefined) return held.signal
        const controller = new AbortController()
        const chip = { controller, signal: AbortSignal.any([signal, controller.signal]) }
        chips.set(path, chip)
        return chip.signal
      },
      chipsClosed: (tabId, paths) => {
        const chips = chipSignals.get(tabId)
        if (chips === undefined) return
        for (const path of paths) {
          const chip = chips.get(path)
          if (chip === undefined) continue
          chips.delete(path)
          chip.controller.abort()
        }
      },
      async gitStatus(tabId, cwd, signal) {
        const token = nextRead(tabId, 'git.status')
        const value = await readGitStatus(cwd, signal)
        return { value, current: currentRead(tabId, 'git.status', token) }
      },
      async gitDiff(tabId, cwd, request, signal) {
        const token = nextRead(tabId, 'git.diff')
        const value = await readGitDiff(cwd, request, signal)
        return { value, current: currentRead(tabId, 'git.diff', token) }
      },
      async historyRefs(tabId, cwd, signal) {
        const token = nextRead(tabId, 'history.refs')
        const value = await readHistoryRefs(cwd, signal)
        return { value, current: currentRead(tabId, 'history.refs', token) }
      },
      async history(tabId, cwd, request, signal) {
        const token = nextRead(tabId, 'history.list')
        const value = await readHistory(cwd, request, signal)
        return { value, current: currentRead(tabId, 'history.list', token) }
      },
      async commit(tabId, cwd, hash, signal) {
        const token = nextRead(tabId, 'history.commit')
        const value = await readCommit(cwd, hash, signal)
        return { value, current: currentRead(tabId, 'history.commit', token) }
      },
      async commitDiff(tabId, cwd, request, signal) {
        const token = nextRead(tabId, 'history.diff')
        const value = await readCommitDiff(cwd, request, signal)
        return { value, current: currentRead(tabId, 'history.diff', token) }
      },
      collapseAll(tabId, signal) {
        if (signal.aborted) return
        actions.collapsed(tabId)
        const root = roots.get(tabId)
        /* v8 ignore next -- start creates the bucket and the root together, and abort drops both. */
        if (root === undefined) return
        for (const child of [...root.children.values()]) void root.collapse(child.path)
      },
      toggle(tabId, parentPath, path, expanded, signal) {
        if (signal.aborted) return
        const root = roots.get(tabId)
        if (root === undefined) return
        const parent = root.find(parentPath)
        if (parent === undefined && !expanded.includes(parentPath)) return
        const collapsing = expanded.includes(path)
        const next = collapsing ? expanded.filter(value => value !== path) : [...expanded, path]
        root.setExpanded(next)
        if (collapsing) void parent?.collapse(path)
        else parent?.expand(path, next)
        actions.toggled(tabId, path)
      },
    }
  }
}
