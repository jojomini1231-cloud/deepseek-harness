/**
 * The files workbench: the workspace root's path row, then the open files'
 * chips and the file the reader is looking at beside the directory tree.
 *
 * Everything the workbench keeps lives in its store, keyed by tab; everything it
 * asks for goes through its injected face. The body decides only what to draw and
 * what a gesture means: a directory row toggles, a file row opens a chip and
 * shows that file, a chip shows or closes its file, and the divider settles a
 * ratio. The file itself is drawn by the reusable `sidebar.document.preview`
 * Factory, so this package owns no document format.
 *
 * The body owns one lifetime per open chip: the store's bucket — chips, ratio,
 * scroll — belongs to the tab, while each chip's preview state belongs to a
 * signal the body composes from the tab's and the chip's own controller, so
 * closing a chip releases its preview without touching its siblings.
 */
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import type { ReactNode } from 'react'
import {
  IconChevronLeftOutlineRegular, IconChevronsInwardOutlineRegular, IconChevronsUpDownOutlineRegular,
  IconPauseOutlineRegular, IconPlayOutlineRegular, IconRefreshOutlineRegular, PathLabel, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  PropsLocale, PropsRenderFactories, PropsRenderSlots, PropsRuntime, PropsStore,
} from '@deepseek-ai/dsh-client-ui-slots'
import { fileAddressFor, pathPartsOf } from '@deepseek-ai/dsh-util-workspace-path'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/client'
import type { WorkspaceGitEntry } from '@deepseek-ai/dsh-workspace-changes/types'
import { HISTORY_PAGE_SIZE, sameGitRefs } from '../git.ts'
import { useNarrowLayout } from './layout.ts'
import { useDrillDownFocus } from './drill-down-focus.ts'
import type { FilesInjected } from './face.ts'
import { FileTabs } from './FileTabs.tsx'
import type {} from './locales.ts'
import { SplitView } from './SplitView.tsx'
import { FILES_RAIL_ITEM, GIT_RAIL_ITEM, HISTORY_RAIL_ITEM, WorkbenchRail } from './WorkbenchRail.tsx'
import { GitPanel } from './GitPanel.tsx'
import { HistoryPanel } from './HistoryPanel.tsx'
import { pickHistoryFile, renameOrigin, resolveHistoryRef } from './history.ts'
import type { createFilesStore, HistoryTabState, OpenFile } from './store.ts'
import { TreeList } from './tree.tsx'
import type { TreeContext } from './tree.tsx'
import css from './FilesBody.module.css'

/** The body's composed props: the tab it draws, its store, its face, its copy, and the preview Factory. */
export type FilesBodyProps =
  & PropsRuntime<'sidebar.right.pane.tab'>
  & PropsRenderSlots<'sidebar.right.tab.files.actions' | 'sidebar.right.tab.files.chip.actions'>
  & PropsRenderFactories
  & PropsStore<ReturnType<typeof createFilesStore>>
  & FilesInjected
  & PropsLocale<'sidebarFiles'>

/**
 * The chip and address one tree row opens.
 * @param sessionId - the session whose workspace holds the file.
 * @param root - the tree's absolute workspace root.
 * @param path - the file's absolute path.
 * @returns the open file's entry.
 */
export function openFileFor(sessionId: Parameters<typeof fileAddressFor>[0], root: string, path: string): OpenFile {
  return { path, address: fileAddressFor(sessionId, root, path), name: pathPartsOf(path).name }
}

/** Milliseconds between the git view's quiet working-tree reads. */
const GIT_SILENT_REFRESH_MS = 3_000

/** Milliseconds between the history view's quiet repository reads. */
const HISTORY_SILENT_REFRESH_MS = 3_000

/** The files workbench: the workspace root and whatever the reader has open under it. */
export function FilesBody({
  useTabInfo, sessionId, useSessions, useStore, actions, renderSlot, renderFactorySlot,
  start, refresh, setAutoRefresh, toggle, collapseAll, chipSignal, chipsClosed,
  gitStatus, gitDiff, historyRefs, history: readHistory, commit, commitDiff, t,
}: FilesBodyProps): ReactNode {
  const { tab, sidebar } = useTabInfo()
  useEffect(() => tab.actions.bindCommands({ refresh: () => { refresh(tab.id) } }), [tab.actions, tab.id, refresh])
  const { signal } = tab
  const cwd = useSessions(sessions => sessions.byId[sessionId]?.cwd)
  const state = useStore(store => store.byTab[tab.id])
  // The workbench's own measured width decides every container's one-column
  // fallback, not a window media query: the Sidebar is resizable.
  const { setRoot: setContainerHost, narrow } = useNarrowLayout()
  const bodyRef = useRef<HTMLDivElement>(null)
  const scrollTopRef = useRef(0)
  // The reads each gesture supersedes; a newer probe or comparison aborts the
  // one still in flight, and the face drops whichever settles out of order.
  const gitProbe = useRef<AbortController | undefined>(undefined)
  const gitCompare = useRef<{ controller: AbortController; path: string } | undefined>(undefined)
  // The history reads: the refs, the list pages, and the two reads of the
  // shown commit (its detail and the selected file's comparison). A gesture
  // aborts the read it supersedes; a container switch abandons none of them,
  // because the slice belongs to the tab rather than to the visible panel.
  const historyRefsRead = useRef<AbortController | undefined>(undefined)
  const historyListRead = useRef<AbortController | undefined>(undefined)
  const historyDetailRead = useRef<AbortController | undefined>(undefined)
  const historyDiffRead = useRef<AbortController | undefined>(undefined)
  // The selection the latest committed render shows. A status read settles
  // after a gesture may have moved it, so its settlement reads the current one.
  const gitSelection = useRef<{ path: string; from: string | undefined } | undefined>(undefined)
  gitSelection.current = state?.git.selected === undefined
    ? undefined
    : { path: state.git.selected, from: state.git.selectedFrom }
  // The scope the latest committed render shows. A status read settles after
  // the reader may have switched it, so its settlement reads the current one.
  const gitComplete = useRef(true)
  gitComplete.current = state?.git.diffComplete ?? false
  // The latest committed history slice: a read settles after a gesture may
  // have moved the selection, so its settlement reads the current one.
  const historyState = useRef<HistoryTabState | undefined>(undefined)
  historyState.current = state?.history
  // A working directory outside a repository has no git or history view; an
  // unavailable or failed status read keeps both so their retries stay reachable.
  const worktreeView = state !== undefined
    && (state.git.status?.kind === 'repository' || state.git.status?.kind === 'unavailable' || state.git.failure)
  const gitContainer = worktreeView && state.container === 'git'
  const historyContainer = worktreeView && state.container === 'history'
  // The history slice belongs to the tab, not to the container: a read that
  // lands after the reader left still fills it, and returning shows what
  // arrived meanwhile, so a container switch abandons no read. The one read it
  // defers is the page a refs settlement owes: starting it for a view nobody is
  // looking at would be wasted work, and dropping it would show an empty list
  // on return, so it waits in `historyPageOwed` until the container is back.
  const historyOpen = useRef(false)
  historyOpen.current = historyContainer
  const historyPageOwed = useRef<{ root: string; ref: string | undefined } | undefined>(undefined)
  const filesContainer = state !== undefined && state.container === 'files'
  // The narrow preview drill-down unmounts whichever control held the keyboard
  // in both directions, so a gesture hands focus to the control its own state
  // names: the back control as the preview opens, and the tree row it came from
  // when the tree returns.
  const panelRef = useRef<HTMLDivElement | null>(null)
  const previewOpen = filesContainer && narrow && state.pageOpen && state.active !== undefined
  useDrillDownFocus(panelRef, previewOpen, narrow, (panel, open) => {
    if (open) return panel.querySelector<HTMLElement>('[data-files-files-back]')
    const active = state?.active
    const rows = panel.querySelectorAll<HTMLElement>('[data-files-path]')
    const row = active === undefined
      ? undefined
      : [...rows].find(candidate => candidate.dataset.filesPath === active)
    return row?.querySelector<HTMLElement>('button')
      ?? panel.querySelector<HTMLElement>('[data-files-tree-action="expand"]')
  })
  // Come back where the reader was: loaded levels outlive the body in the
  // store, so a remounted tree lays out at its full height before this runs
  // and the stored offset re-lands exactly. Switching to another container
  // unmounts the tree without writing the store, so the live offset kept in
  // the ref wins over the stored one. Crossing the narrow threshold and opening
  // or leaving the preview drill-down both remount the tree's scroller, so the
  // layout and the drill-down are dependencies for the same reason the
  // container is.
  const seeded = state !== undefined
  useLayoutEffect(() => {
    const body = bodyRef.current
    if (seeded && body !== null) {
      body.scrollTop = scrollTopRef.current || state.scrollTop
      scrollTopRef.current = body.scrollTop
    }
  }, [seeded, filesContainer, narrow, state?.pageOpen, state?.scrollTop])
  // Scrolling only moves the ref; the store hears about it once, on unmount,
  // so a scroll neither re-renders the tree nor writes after the owner's
  // abort has forgotten the bucket.
  useEffect(() => () => {
    if (seeded && !signal.aborted) actions.scrolled(tab.id, scrollTopRef.current)
  }, [seeded, signal, tab.id, actions])
  useEffect(() => {
    // A bucket gone because the record aborted must not be re-seeded by a
    // component that has not unmounted yet.
    if (state !== undefined || cwd === undefined || signal.aborted) return
    start(tab.id, cwd, signal)
    probeGit(cwd)
    // The probe belongs to this seeding step: one per tab, not per store write.
  }, [state, cwd, tab.id, signal, start])

  // The rail offers the git container for a repository, and for an unavailable
  // or failed status read so its retry stays reachable. The seeding effect
  // probes once per tab, and the panel's reload and retry gestures probe again;
  // reads are gesture-driven so a store write never starts a request of its own.
  const requestDiff = (root: string, path: string, from: string | undefined, complete: boolean): void => {
    gitCompare.current?.controller.abort()
    const controller = new AbortController()
    gitCompare.current = { controller, path }
    const read = AbortSignal.any([signal, controller.signal])
    const request = { path, complete, ...(from === undefined ? {} : { from }) }
    void gitDiff(tab.id, root, request, read).then((answer) => {
      // The read is no longer in flight, whether or not its answer is current.
      if (gitCompare.current?.controller === controller) gitCompare.current = undefined
      if (signal.aborted || !answer.current) return
      if (answer.value === undefined) actions.gitDiffFailed(tab.id, path)
      else actions.gitDiffLoaded(tab.id, path, answer.value)
    })
  }
  /**
   * Read the working tree's status, and the shown path's comparison with it.
   * @param root - the Session working directory.
   * @param options - `quiet` refreshes in place without a loading state, and
   * `comparison: false` reads only the status for the history view's poll.
   */
  const probeGit = (
    root: string,
    { quiet = false, comparison = true }: { readonly quiet?: boolean; readonly comparison?: boolean } = {},
  ): void => {
    gitProbe.current?.abort()
    const controller = new AbortController()
    gitProbe.current = controller
    const read = AbortSignal.any([signal, controller.signal])
    // The path the gesture wants refreshed. The reader may select another path
    // while the status read runs; that selection reads the current tree itself.
    const refreshing = gitSelection.current
    if (!quiet) actions.gitLoading(tab.id)
    void gitStatus(tab.id, root, read).then((answer) => {
      if (signal.aborted || !answer.current) return
      if (answer.value === undefined) {
        actions.gitStatusFailed(tab.id)
        return
      }
      actions.gitStatusLoaded(tab.id, answer.value)
      const current = gitSelection.current
      const shown = current === undefined
        ? undefined
        : answer.value.entries.find(value => value.path === current.path)
      // The status dropped the shown path: its in-flight comparison is moot.
      if (current !== undefined && shown === undefined && gitCompare.current?.path === current.path) {
        gitCompare.current.controller.abort()
        gitCompare.current = undefined
      }
      // The history view draws no comparison: its poll keeps the status (and the
      // list's uncommitted-changes row) current without reading the git view.
      if (!comparison) return
      // Refresh the comparison the gesture showed the reader, unless they moved
      // to another path or a comparison started after the gesture is in flight.
      if (refreshing === undefined || current?.path !== refreshing.path || shown === undefined
        || gitCompare.current !== undefined) return
      if (!quiet) actions.gitDiffReloading(tab.id)
      requestDiff(root, shown.path, shown.from, gitComplete.current)
    })
  }
  // While the git view is the one on screen the tree refreshes itself: a quiet
  // read every few seconds that only writes when the working tree differs, so
  // the rows never blank out and an unchanged tree costs no render. The latest
  // probe is reached through a ref because the timer outlives one render.
  const probeLatest = useRef(probeGit)
  useEffect(() => { probeLatest.current = probeGit })
  // A hidden panel keeps its tab bodies mounted, so the view has to ask whether
  // it is on screen: a collapsed Sidebar or a hidden tab must not keep reading.
  const onScreen = tab.visible && sidebar.expanded
  const gitRoot = gitContainer && onScreen ? state.root : undefined
  const polled = useRef(false)
  useEffect(() => {
    if (gitRoot === undefined) return undefined
    // The first activation already read the tree while seeding; coming back on
    // screen after a collapse refreshes at once, then the interval keeps it fresh.
    if (polled.current) probeLatest.current(gitRoot, { quiet: true })
    polled.current = true
    const timer = setInterval(() => { probeLatest.current(gitRoot, { quiet: true }) }, GIT_SILENT_REFRESH_MS)
    return () => { clearInterval(timer) }
  }, [gitRoot])
  const selectGitEntry = (entry: WorkspaceGitEntry): void => {
    /* v8 ignore next -- the panel that reports the gesture only renders with a seeded state. */
    if (state === undefined) return
    actions.gitEntrySelected(tab.id, entry.path, entry.from)
    requestDiff(state.root, entry.path, entry.from, state.git.diffComplete)
  }
  const retryGitDiff = (): void => {
    /* v8 ignore next -- the panel that reports the gesture only renders with a seeded state. */
    if (state === undefined || state.git.selected === undefined) return
    actions.gitDiffReloading(tab.id)
    requestDiff(state.root, state.git.selected, state.git.selectedFrom, state.git.diffComplete)
  }
  // The history view's reads follow the same rule as the git view's: gestures
  // start them, each read aborts the one it supersedes, and a settlement writes
  // only while its answer is the current one. The commit page chains from the
  // list (its first commit) and from the detail (its first changed file).
  const requestCommit = (root: string, hash: string): void => {
    historyDetailRead.current?.abort()
    const controller = new AbortController()
    historyDetailRead.current = controller
    const read = AbortSignal.any([signal, controller.signal])
    void commit(tab.id, root, hash, read).then((answer) => {
      if (historyDetailRead.current === controller) historyDetailRead.current = undefined
      if (signal.aborted || controller.signal.aborted || !answer.current) return
      if (answer.value === undefined) actions.historyDetailFailed(tab.id, hash)
      else actions.historyDetailLoaded(tab.id, hash, answer.value)
    })
  }
  const requestCommitDiff = (root: string, hash: string, path: string, from: string | undefined, complete: boolean): void => {
    historyDiffRead.current?.abort()
    const controller = new AbortController()
    historyDiffRead.current = controller
    const read = AbortSignal.any([signal, controller.signal])
    const request = { hash, path, complete, ...(from === undefined ? {} : { from }) }
    void commitDiff(tab.id, root, request, read).then((answer) => {
      if (historyDiffRead.current === controller) historyDiffRead.current = undefined
      if (signal.aborted || controller.signal.aborted || !answer.current) return
      if (answer.value === undefined) actions.historyDiffFailed(tab.id, hash, path)
      else actions.historyDiffLoaded(tab.id, hash, path, answer.value)
    })
  }
  /**
   * Read one page of the walked ref.
   * @param root - the Session working directory.
   * @param skip - the commits to skip before the page.
   * @param ref - the walked ref, `undefined` for all refs.
   * @param quiet - refresh in place: no loading state, and the page settles
   * into the loaded list rather than replacing it.
   */
  const requestHistoryPage = (root: string, skip: number, ref: string | undefined, quiet = false): void => {
    historyListRead.current?.abort()
    const controller = new AbortController()
    historyListRead.current = controller
    if (!quiet) actions.historyLoading(tab.id)
    // The list this read continues, as it stands now: a page that lands after
    // the list was restarted is not an answer to it, however the ref and the
    // offset compare by then.
    /* v8 ignore next -- the history bucket exists whenever a page is requested; zero is a defensive default. */
    const epoch = historyState.current?.listEpoch ?? 0
    const read = AbortSignal.any([signal, controller.signal])
    const request = ref === undefined
      ? { skip, limit: HISTORY_PAGE_SIZE }
      : { ref, skip, limit: HISTORY_PAGE_SIZE }
    void readHistory(tab.id, root, request, read).then((answer) => {
      if (historyListRead.current === controller) historyListRead.current = undefined
      if (signal.aborted || controller.signal.aborted || !answer.current) return
      if (answer.value === undefined) {
        // A missed quiet read leaves the drawn rows and their failure state alone.
        if (!quiet) actions.historyFailed(tab.id)
        return
      }
      if (quiet) actions.historyPageRefreshed(tab.id, ref, answer.value)
      else actions.historyLoaded(tab.id, ref, skip, epoch, answer.value)
    })
  }
  const requestHistoryRefs = (root: string): void => {
    historyRefsRead.current?.abort()
    const controller = new AbortController()
    historyRefsRead.current = controller
    actions.historyRefsLoading(tab.id)
    const read = AbortSignal.any([signal, controller.signal])
    void historyRefs(tab.id, root, read).then((answer) => {
      if (historyRefsRead.current === controller) historyRefsRead.current = undefined
      if (signal.aborted || controller.signal.aborted || !answer.current) return
      if (answer.value === undefined) {
        actions.historyRefsFailed(tab.id)
        return
      }
      // The ref the list walks once this answer is applied: the reader's pick
      // while the repository still reports it, and the attached branch
      // otherwise, so a first read opens on the branch that is checked out. A
      // pick made while the refs were being read started its own page read, and
      // an unchanged ref keeps that read instead of aborting it.
      const current = historyState.current
      const walked = resolveHistoryRef(answer.value, current?.ref, current?.refPicked === true)
      actions.historyRefsLoaded(tab.id, answer.value, walked)
      /* v8 ignore next 2 -- the picked ref's own page read replaces the old one; the guard covers that race. */
      if (walked === current?.ref && historyListRead.current !== undefined) return
      if (!historyOpen.current) {
        // The slice states the page it owes, so returning to the container
        // shows the list's loading state rather than an empty one.
        actions.historyLoading(tab.id)
        historyPageOwed.current = { root, ref: walked }
        return
      }
      requestHistoryPage(root, 0, walked)
    })
  }
  /**
   * Refresh the history view in place: the working tree's status (the list's
   * uncommitted-changes row), then the refs, then the walked ref's first page
   * when the refs answer moved or the drawn list still states a failure. Every
   * settlement writes only what changed, so an unchanged repository costs no
   * render and never blanks the rows. A read already in flight owns its route,
   * so a poll starts no second read of the same kind.
   * @param root - the Session working directory.
   */
  const probeHistory = (root: string): void => {
    // The status keeps the uncommitted-changes row current; the comparison
    // belongs to the git container the reader is not looking at.
    probeGit(root, { quiet: true, comparison: false })
    if (historyRefsRead.current !== undefined) return
    const controller = new AbortController()
    historyRefsRead.current = controller
    const read = AbortSignal.any([signal, controller.signal])
    void historyRefs(tab.id, root, read).then((answer) => {
      if (historyRefsRead.current === controller) historyRefsRead.current = undefined
      if (signal.aborted || controller.signal.aborted || !answer.current) return
      // A missed quiet read leaves the drawn view alone: the reader's own reload
      // and its retry own the failure states.
      if (answer.value === undefined) return
      // The reader left while the read ran; the return reads at once.
      if (!historyOpen.current) return
      const current = historyState.current
      const walked = resolveHistoryRef(answer.value, current?.ref, current?.refPicked === true)
      const restarted = walked !== current?.ref
      const moved = !sameGitRefs(current?.refs, answer.value)
      // The all-refs scope has a tip only while a branch is attached; a detached
      // HEAD is absent from the refs answer, so its page is read on every poll
      // rather than waiting for a ref to move.
      const tipKnown = walked !== undefined || answer.value.some(ref => ref.head === true)
      actions.historyRefsLoaded(tab.id, answer.value, walked)
      if (!restarted && !moved && tipKnown && current?.failure !== true) return
      // A restarted walk replaced the list, so its first page is read even when
      // a page read was in flight; otherwise the reader's read owns the list.
      if (!restarted && historyListRead.current !== undefined) return
      requestHistoryPage(root, 0, walked, !restarted)
    })
  }
  // The latest committed probe, reached through a ref because the timer
  // outlives one render.
  const probeHistoryLatest = useRef(probeHistory)
  useEffect(() => { probeHistoryLatest.current = probeHistory })
  // The history view refreshes itself while it is the one on screen, like the
  // git view. A hidden panel keeps its tab bodies mounted, so the view has to
  // ask whether it is on screen: a collapsed Sidebar or a hidden tab must not
  // keep reading, and a returning one reads at once.
  const historyRoot = historyContainer && onScreen ? state.root : undefined
  const historyPolled = useRef(false)
  useEffect(() => {
    if (historyRoot === undefined) return undefined
    // The first activation already read the refs while seeding; coming back on
    // screen after a collapse refreshes at once, then the interval keeps it fresh.
    if (historyPolled.current) probeHistoryLatest.current(historyRoot)
    historyPolled.current = true
    const timer = setInterval(() => { probeHistoryLatest.current(historyRoot) }, HISTORY_SILENT_REFRESH_MS)
    return () => { clearInterval(timer) }
  }, [historyRoot])
  const selectHistoryRef = (ref: string | undefined): void => {
    /* v8 ignore next -- the filter that reports the pick only renders with a seeded state. */
    if (state === undefined) return
    actions.historyRefSelected(tab.id, ref)
    requestHistoryPage(state.root, 0, ref)
  }
  const selectHistoryCommit = (hash: string): void => {
    /* v8 ignore next -- the row that reports the pick only renders with a seeded state. */
    if (state === undefined) return
    const current = historyState.current
    actions.historyCommitSelected(tab.id, hash)
    // A repeated pick keeps the settled page; one that failed opens it again.
    if (current?.selected === hash && current.detail !== undefined && current.detail !== 'failed') return
    requestCommit(state.root, hash)
  }
  const selectHistoryFile = (path: string): void => {
    /* v8 ignore next -- the row that reports the pick only renders with a seeded state. */
    if (state === undefined) return
    const current = historyState.current
    const detail = current?.detail
    /* v8 ignore next -- the row that reports the pick only renders with a loaded detail. */
    if (current?.selected === undefined || typeof detail !== 'object') return
    const file = detail.files.find(value => value.path === path)
    /* v8 ignore next -- the rows only carry the detail's own files. */
    if (file === undefined) return
    actions.historyFileSelected(tab.id, path)
    requestCommitDiff(state.root, current.selected, path, file.from, state.history.diffComplete)
  }
  const retryHistoryList = (): void => {
    /* v8 ignore next -- the note that reports the gesture only renders with a seeded state. */
    if (state === undefined) return
    requestHistoryPage(state.root, 0, historyState.current?.ref)
  }
  const refreshHistory = (): void => {
    /* v8 ignore next -- the header that reports the gesture only renders with a seeded state. */
    if (state === undefined) return
    const current = historyState.current
    requestHistoryRefs(state.root)
    if (current?.selected === undefined) return
    actions.historyDetailLoading(tab.id, current.selected)
    requestCommit(state.root, current.selected)
    if (current.file === undefined) return
    actions.historyDiffLoading(tab.id, current.selected, current.file)
    requestCommitDiff(state.root, current.selected, current.file, renameOrigin(current.detail, current.file), current.diffComplete)
  }
  const retryHistoryDetail = (): void => {
    /* v8 ignore next -- the note that reports the gesture only renders with a seeded state. */
    if (state === undefined || historyState.current?.selected === undefined) return
    const hash = historyState.current.selected
    actions.historyDetailLoading(tab.id, hash)
    requestCommit(state.root, hash)
  }
  const retryHistoryDiff = (): void => {
    /* v8 ignore next -- the note that reports the gesture only renders with a seeded state. */
    if (state === undefined) return
    const current = historyState.current
    /* v8 ignore next -- the note that reports the gesture only renders with a shown file. */
    if (current?.selected === undefined || current.file === undefined) return
    actions.historyDiffLoading(tab.id, current.selected, current.file)
    requestCommitDiff(state.root, current.selected, current.file, renameOrigin(current.detail, current.file), current.diffComplete)
  }
  const loadMoreHistory = (): void => {
    /* v8 ignore next -- the button that reports the gesture only renders with a seeded state. */
    if (state === undefined) return
    const current = historyState.current
    /* v8 ignore next -- the button only renders with more pages and an idle read. */
    if (current === undefined || !current.hasMore || current.loading) return
    requestHistoryPage(state.root, current.commits.length, current.ref)
  }
  // Selecting the history container seeds its reads once per tab: the refs
  // first, then the first page of the ref the filter walks. A failed refs read
  // offers its retry instead of looping, so the seed is not re-armed by it.
  const historySeedRoot = historyContainer && state.history.refs === undefined
    && !state.history.refsLoading && !state.history.refsFailure
    ? state.root
    : undefined
  const seedHistory = useRef(requestHistoryRefs)
  useEffect(() => { seedHistory.current = requestHistoryRefs })
  useEffect(() => {
    if (historySeedRoot === undefined || signal.aborted) return
    seedHistory.current(historySeedRoot)
    // One seed per tab and container selection, not per store write.
  }, [historySeedRoot])
  // The page a refs read settled on while the reader was elsewhere: the
  // container's return starts it, so the list is filled rather than empty.
  useEffect(() => {
    const owed = historyPageOwed.current
    if (!historyContainer || owed === undefined) return
    historyPageOwed.current = undefined
    requestHistoryPage(owed.root, 0, owed.ref)
  }, [historyContainer])
  // A loaded page picks its first commit, and a loaded commit detail picks its
  // first changed file, so the wide layout opens on content without a gesture.
  // The effects depend on the primitive fields, not on the fresh object a
  // render builds: every store write re-renders the body, and an object
  // dependency would re-enter the read on each of them.
  const historyAutoCommit = historyContainer && !state.history.loading
    && state.history.refs !== undefined && state.history.selected === undefined && state.history.commits.length > 0
    ? { root: state.root, hash: state.history.commits[0]?.hash }
    : undefined
  const autoCommitRoot = historyAutoCommit?.root
  const autoCommitHash = historyAutoCommit?.hash
  useEffect(() => {
    if (autoCommitRoot === undefined || autoCommitHash === undefined) return
    actions.historyCommitSelected(tab.id, autoCommitHash)
    requestCommit(autoCommitRoot, autoCommitHash)
  }, [autoCommitRoot, autoCommitHash])
  const historyDetail = state?.history.detail
  const historyAutoFile = historyContainer && typeof historyDetail === 'object' && historyDetail.files.length > 0
    && (state.history.file === undefined || !historyDetail.files.some(file => file.path === state.history.file))
    ? {
      root: state.root,
      hash: historyDetail.commit.hash,
      file: pickHistoryFile(historyDetail.files),
      complete: state.history.diffComplete,
    }
    : undefined
  const autoFileRoot = historyAutoFile?.root
  const autoFileHash = historyAutoFile?.hash
  const autoFilePath = historyAutoFile?.file?.path
  const autoFileFrom = historyAutoFile?.file?.from
  const autoFileComplete = historyAutoFile?.complete
  useEffect(() => {
    if (autoFileRoot === undefined || autoFileHash === undefined || autoFilePath === undefined
      || autoFileComplete === undefined) return
    actions.historyFileSelected(tab.id, autoFilePath)
    requestCommitDiff(autoFileRoot, autoFileHash, autoFilePath, autoFileFrom, autoFileComplete)
  }, [autoFileRoot, autoFileHash, autoFilePath, autoFileFrom, autoFileComplete])
  const tree = useMemo((): TreeContext | undefined => state === undefined ? undefined : {
    state,
    onToggle: (parent, path) => { toggle(tab.id, parent, path, state.expanded, signal) },
    onOpen: (path) => {
      actions.fileOpened(tab.id, openFileFor(sessionId, state.root, path))
      // A narrow pick is the preview drill-down; the wide layout draws the
      // preview beside the tree and records nothing here.
      if (!narrow) return
      actions.filesPageOpened(tab.id, true)
    },
    t,
  }, [state, tab.id, sessionId, toggle, actions, signal, t, narrow])
  // The two columns are memoized so a divider drag re-renders neither the tree
  // nor the document behind it. The chip lifetimes are minted at memo time:
  // `chipSignal` hands back the same composed signal for a chip already open,
  // so the memo re-running never re-keys the preview's state.
  /**
   * Rows other plugins contribute to a chip's menu, rendered with the menu so
   * they join its keyboard walk; picking one dismisses it.
   * @param path - absolute path of the file whose chip menu is open.
   * @param onPicked - the menu's dismiss callback.
   * @returns the contributed rows, or nothing when none registered.
   */
  const renderMenuRow = useMemo(
    () => (path: string, onPicked: () => void): ReactNode =>
      renderSlot('sidebar.right.tab.files.chip.actions', { path, onPicked }),
    [renderSlot],
  )
  const contentColumn = useMemo((): ReactNode => {
    if (state === undefined) return null
    const value = state
    const active = value.open.find(file => file.path === value.active)
    // Every close names the chips it removes, so their preview lifetimes end
    // with their store entries rather than the tab's.
    const close = (paths: readonly string[], closed: () => void): void => {
      chipsClosed(tab.id, paths.filter(path => value.open.some(open => open.path === path)))
      closed()
    }
    return (
      <>
        <FileTabs
          files={value.open}
          active={value.active}
          onOpen={(path) => { actions.fileActivated(tab.id, path) }}
          onClose={(path) => { close([path], () => { actions.fileClosed(tab.id, path) }) }}
          onCloseOthers={(path) => {
            close(value.open.map(open => open.path).filter(open => open !== path),
              () => { actions.filesClosedExcept(tab.id, path) })
          }}
          onCloseAll={() => { close(value.open.map(open => open.path), () => { actions.filesClosedAll(tab.id) }) }}
          onCloseLeft={(path) => {
            const at = value.open.findIndex(open => open.path === path)
            close(value.open.slice(0, Math.max(at, 0)).map(open => open.path), () => { actions.filesClosedBefore(tab.id, path) })
          }}
          onCloseRight={(path) => {
            const at = value.open.findIndex(open => open.path === path)
            close(value.open.slice(at + 1).map(open => open.path), () => { actions.filesClosedAfter(tab.id, path) })}
          }
          renderMenuRow={renderMenuRow}
          t={t}
        />
        <div className={css.preview} data-files-preview>
          {active === undefined
            ? <p className={css.previewEmpty} data-files-preview-state="empty">{t('preview.empty')}</p>
            : renderFactorySlot('sidebar.document.preview', {
              address: active.address,
              // The tab id prefix keeps two workbench tabs over the same file
              // in separate preview buckets.
              viewKey: `${tab.id}:${active.path}`,
              navigation: { address: active.address, params: undefined, revision: 1 },
              signal: chipSignal(tab.id, active.path, signal),
            })}
        </div>
      </>
    )
  }, [state?.open, state?.active, actions, tab.id, signal,
    chipSignal, chipsClosed, t, renderFactorySlot, renderMenuRow])
  const treeColumn = useMemo((): ReactNode => {
    if (tree === undefined || state === undefined) return null
    /** Open every directory the tree has listed; deeper levels follow on the next press. */
    const expandAll = (): void => {
      for (const [parent, level] of Object.entries(state.levels)) {
        if (level.kind !== 'ready') continue
        for (const directory of level.level.entries.filter(entry => entry.type === 'directory')) {
          const path = `${parent.replace(/[/\\]+$/, '')}/${directory.name}`
          if (state.expanded.includes(path)) continue
          toggle(tab.id, parent, path, state.expanded, signal)
        }
      }
    }
    const treeHeader = (
      <div className={css.treeHeader} data-files-tree-header>
        <span className={css.treeTitle} data-files-tree-title>{t('tree.title')}</span>
        <div className={css.treeActions} role="toolbar" aria-label={t('tree.actions.aria')}>
          <Tooltip label={t('tree.expand')} side="bottom" delayMs={300}>
            <button
              type="button"
              className={css.tool}
              aria-label={t('tree.expand')}
              data-files-tree-action="expand"
              onClick={expandAll}
            >
              <IconChevronsUpDownOutlineRegular />
            </button>
          </Tooltip>
          <Tooltip label={t('tree.collapse')} side="bottom" delayMs={300}>
            <button
              type="button"
              className={css.tool}
              aria-label={t('tree.collapse')}
              data-files-tree-action="collapse"
              onClick={() => { collapseAll(tab.id, signal) }}
            >
              <IconChevronsInwardOutlineRegular />
            </button>
          </Tooltip>
        </div>
      </div>
    )
    return (
      <>
        {treeHeader}
        <div
          ref={bodyRef}
          className={css.body}
          data-files-body
          onScroll={(event) => { scrollTopRef.current = event.currentTarget.scrollTop }}
        >
          <TreeList {...tree} />
        </div>
      </>
    )
  }, [tree, state, collapseAll, toggle, tab.id, signal, t])

  if (cwd === undefined) {
    return (
      <div className={css.status} data-files-state="no-workspace">
        <p className={css.statusLine}>{t('noWorkspace')}</p>
      </div>
    )
  }
  if (state === undefined) return null
  const reload = (): void => {
    refresh(tab.id)
  }
  // Switching the comparison's scope replaces the drawn comparison: the shown
  // path (or commit file) is read again in the other scope, and the read in
  // flight for the old scope is aborted so its answer never lands. The settled
  // comparison stays drawn while the other scope is read, so the header keeps
  // its controls and their focus instead of flashing a loading note.
  const selectGitDiffComplete = (complete: boolean): void => {
    actions.gitDiffCompleteSelected(tab.id, complete)
    const selected = state.git.selected
    /* v8 ignore next -- the scope control renders only beside a settled comparison. */
    if (selected === undefined) return
    requestDiff(state.root, selected, state.git.selectedFrom, complete)
  }
  const selectHistoryDiffComplete = (complete: boolean): void => {
    actions.historyDiffCompleteSelected(tab.id, complete)
    const current = historyState.current
    /* v8 ignore next -- the scope control renders only beside a shown file comparison. */
    if (current?.selected === undefined || current.file === undefined) return
    requestCommitDiff(state.root, current.selected, current.file, renameOrigin(current.detail, current.file), complete)
  }
  // A narrow pick opens the preview drill-down; it only exists while a file is
  // shown, so closing the last chip returns to the tree.
  return (
    <div ref={panelRef} className={css.root} data-files-state="tree" data-files-root={state.root}>
      <div className={css.header}>
        {previewOpen && (
          <Tooltip label={t('files.back.aria')} side="bottom" delayMs={300}>
            <button
              type="button"
              className={css.filesBack}
              aria-label={t('files.back.aria')}
              data-files-files-back
              onClick={() => { actions.filesPageOpened(tab.id, false) }}
            >
              <IconChevronLeftOutlineRegular />
              <span>{t('files.back')}</span>
            </button>
          </Tooltip>
        )}
        <PathLabel path={state.root} className={css.path} data-files-path />
        <span hidden>
          <button type="button" className={css.tool} aria-label={t('autoRefresh')}
            aria-pressed={state.autoRefresh} data-files-auto-refresh
            title={t(state.autoRefresh ? 'autoRefresh.disable' : 'autoRefresh.enable')}
            onClick={() => { setAutoRefresh(tab.id, !state.autoRefresh) }}>
            {state.autoRefresh ? <IconPauseOutlineRegular /> : <IconPlayOutlineRegular />}
          </button>
        </span>
        <Tooltip label={t('reload')} shortcutKeys={tab.refreshShortcut?.keys} side="bottom" delayMs={500}>
          <button
            type="button"
            className={css.tool}
            aria-label={t('reload')}
            aria-keyshortcuts={tab.refreshShortcut?.aria}
            data-files-reload
            onClick={reload}
          >
            <IconRefreshOutlineRegular />
          </button>
        </Tooltip>
        {renderSlot('sidebar.right.tab.files.actions', {
          absolutePath: state.root,
        })}
      </div>
      <div className={css.railRow}>
        <div
          ref={setContainerHost}
          className={css.containerHost}
          data-files-container-host
          data-files-files-layout={state.container === 'files' ? (narrow ? 'narrow' : 'wide') : undefined}
          data-files-files-page={state.container === 'files' ? (previewOpen ? 'open' : 'list') : undefined}
        >
          {gitContainer ? (
            <GitPanel
              git={state.git}
              narrow={narrow}
              onSelect={selectGitEntry}
              onDrillDown={() => { actions.gitPageOpened(tab.id, true) }}
              onBack={() => { actions.gitPageOpened(tab.id, false) }}
              onReload={() => { probeGit(state.root) }}
              onRetryDiff={retryGitDiff}
              onMode={(mode) => { actions.gitDiffModeSelected(tab.id, mode) }}
              onDiffComplete={selectGitDiffComplete}
              onRatio={(ratio) => { actions.gitRatioChanged(tab.id, ratio) }}
              // The abort forgets the bucket before the unmount reports the offset.
              onScrolled={(scrollTop) => { if (!signal.aborted) actions.gitListScrolled(tab.id, scrollTop) }}
              ratio={state.git.ratio}
              onToggleGroup={(group) => { actions.gitGroupToggled(tab.id, group) }}
              t={t}
            />
          ) : historyContainer ? (
            <HistoryPanel
              history={state.history}
              dirtyCount={state.git.status?.kind === 'repository' ? state.git.status.total : 0}
              onSelectRef={selectHistoryRef}
              onRefresh={refreshHistory}
              onRetryRefs={() => { requestHistoryRefs(state.root) }}
              onLoadMore={loadMoreHistory}
              onRetryList={retryHistoryList}
              onSelectCommit={selectHistoryCommit}
              onDrillDown={() => { actions.historyPageOpened(tab.id, true) }}
              onDirty={() => { actions.containerSelected(tab.id, 'git') }}
              onSelectFile={selectHistoryFile}
              onToggleFiles={() => { actions.historyFilesToggled(tab.id) }}
              onRetryDetail={retryHistoryDetail}
              onRetryDiff={retryHistoryDiff}
              onDiffMode={(mode) => { actions.historyDiffModeSelected(tab.id, mode) }}
              onDiffComplete={selectHistoryDiffComplete}
              onRatio={(ratio) => { actions.historyRatioChanged(tab.id, ratio) }}
              onBack={() => { actions.historyPageOpened(tab.id, false) }}
              // The abort forgets the bucket before the unmount reports an offset.
              onListScrolled={(scrollTop) => { if (!signal.aborted) actions.historyListScrolled(tab.id, scrollTop) }}
              onPageScrolled={(hash, scrollTop) => {
                if (!signal.aborted) actions.historyPageScrolled(tab.id, hash, scrollTop)
              }}
              t={t}
            />
          ) : narrow ? (
            <div className={css.narrowPane} data-files-narrow-pane={previewOpen ? 'preview' : 'tree'}>
              {previewOpen ? contentColumn : treeColumn}
            </div>
          ) : (
            <SplitView
              ratio={state.ratio}
              onRatio={(ratio) => { actions.ratioChanged(tab.id, ratio) }}
              content={contentColumn}
              tree={treeColumn}
              label={t('splitter.aria')}
            />
          )}
        </div>
        <WorkbenchRail
          items={worktreeView
            ? [FILES_RAIL_ITEM, GIT_RAIL_ITEM, HISTORY_RAIL_ITEM]
            : [FILES_RAIL_ITEM]}
          selected={state.container}
          onSelect={(id) => { actions.containerSelected(tab.id, id) }}
          t={t}
        />
      </div>
    </div>
  )
}
