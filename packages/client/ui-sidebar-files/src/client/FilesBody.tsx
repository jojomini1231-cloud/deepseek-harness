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
  IconChevronsInwardOutlineRegular, IconChevronsUpDownOutlineRegular, IconPauseOutlineRegular, IconPlayOutlineRegular,
  IconRefreshOutlineRegular, PathLabel, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  PropsLocale, PropsRenderFactories, PropsRenderSlots, PropsRuntime, PropsStore,
} from '@deepseek-ai/dsh-client-ui-slots'
import { fileAddressFor, pathPartsOf } from '@deepseek-ai/dsh-util-workspace-path'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/client'
import type { WorkspaceGitEntry } from '@deepseek-ai/dsh-workspace-changes/types'
import type { FilesInjected } from './face.ts'
import { FileTabs } from './FileTabs.tsx'
import type {} from './locales.ts'
import { SplitView } from './SplitView.tsx'
import { FILES_RAIL_ITEM, GIT_RAIL_ITEM, WorkbenchRail } from './WorkbenchRail.tsx'
import { GitPanel } from './GitPanel.tsx'
import type { createFilesStore, OpenFile } from './store.ts'
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

/** The files workbench: the workspace root and whatever the reader has open under it. */
export function FilesBody({
  useTabInfo, sessionId, useSessions, useStore, actions, renderSlot, renderFactorySlot,
  start, refresh, setAutoRefresh, toggle, collapseAll, chipSignal, chipsClosed, gitStatus, gitDiff, t,
}: FilesBodyProps): ReactNode {
  const { tab } = useTabInfo()
  useEffect(() => tab.actions.bindCommands({ refresh: () => { refresh(tab.id) } }), [tab.actions, tab.id, refresh])
  const { signal } = tab
  const cwd = useSessions(sessions => sessions.byId[sessionId]?.cwd)
  const state = useStore(store => store.byTab[tab.id])
  const bodyRef = useRef<HTMLDivElement>(null)
  const scrollTopRef = useRef(0)
  // The reads each gesture supersedes; a newer probe or comparison aborts the
  // one still in flight, and the face drops whichever settles out of order.
  const gitProbe = useRef<AbortController | undefined>(undefined)
  const gitCompare = useRef<{ controller: AbortController; path: string } | undefined>(undefined)
  // The selection the latest committed render shows. A status read settles
  // after a gesture may have moved it, so its settlement reads the current one.
  const gitSelection = useRef<{ path: string; from: string | undefined } | undefined>(undefined)
  gitSelection.current = state?.git.selected === undefined
    ? undefined
    : { path: state.git.selected, from: state.git.selectedFrom }
  // Come back where the reader was: loaded levels outlive the body in the
  // store, so a remounted tree lays out at its full height before this runs
  // and the stored offset re-lands exactly. Switching to the git container
  // unmounts the tree without writing the store, so the live offset kept in
  // the ref wins over the stored one.
  const seeded = state !== undefined
  const gitContainer = state !== undefined && state.container === 'git'
    && (state.git.status?.kind === 'repository' || state.git.status?.kind === 'unavailable' || state.git.failure)
  useLayoutEffect(() => {
    const body = bodyRef.current
    if (seeded && body !== null) {
      body.scrollTop = scrollTopRef.current || state.scrollTop
      scrollTopRef.current = body.scrollTop
    }
  }, [seeded, gitContainer, state?.scrollTop])
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
  const requestDiff = (root: string, path: string, from: string | undefined): void => {
    gitCompare.current?.controller.abort()
    const controller = new AbortController()
    gitCompare.current = { controller, path }
    const read = AbortSignal.any([signal, controller.signal])
    void gitDiff(tab.id, root, from === undefined ? { path } : { path, from }, read).then((answer) => {
      // The read is no longer in flight, whether or not its answer is current.
      if (gitCompare.current?.controller === controller) gitCompare.current = undefined
      if (signal.aborted || !answer.current) return
      if (answer.value === undefined) actions.gitDiffFailed(tab.id, path)
      else actions.gitDiffLoaded(tab.id, path, answer.value)
    })
  }
  const probeGit = (root: string): void => {
    gitProbe.current?.abort()
    const controller = new AbortController()
    gitProbe.current = controller
    const read = AbortSignal.any([signal, controller.signal])
    // The path the gesture wants refreshed. The reader may select another path
    // while the status read runs; that selection reads the current tree itself.
    const refreshing = gitSelection.current
    actions.gitLoading(tab.id)
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
      // Refresh the comparison the gesture showed the reader, unless they moved
      // to another path or a comparison started after the gesture is in flight.
      if (refreshing === undefined || current?.path !== refreshing.path || shown === undefined
        || gitCompare.current !== undefined) return
      actions.gitDiffReloading(tab.id)
      requestDiff(root, shown.path, shown.from)
    })
  }
  const selectGitEntry = (entry: WorkspaceGitEntry): void => {
    /* v8 ignore next -- the panel that reports the gesture only renders with a seeded state. */
    if (state === undefined) return
    actions.gitEntrySelected(tab.id, entry.path, entry.from)
    requestDiff(state.root, entry.path, entry.from)
  }
  const retryGitDiff = (): void => {
    /* v8 ignore next -- the panel that reports the gesture only renders with a seeded state. */
    if (state === undefined || state.git.selected === undefined) return
    actions.gitDiffReloading(tab.id)
    requestDiff(state.root, state.git.selected, state.git.selectedFrom)
  }
  const tree = useMemo((): TreeContext | undefined => state === undefined ? undefined : {
    state,
    onToggle: (parent, path) => { toggle(tab.id, parent, path, state.expanded, signal) },
    onOpen: (path) => { actions.fileOpened(tab.id, openFileFor(sessionId, state.root, path)) },
    t,
  }, [state, tab.id, sessionId, toggle, actions, signal, t])
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
        <span className={css.treeTitle} data-files-tree-title>{t('tree.title')}</span>
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
  return (
    <div className={css.root} data-files-state="tree" data-files-root={state.root}>
      <div className={css.header}>
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
        {gitContainer ? (
          <GitPanel
            git={state.git}
            onSelect={selectGitEntry}
            onReload={() => { probeGit(state.root) }}
            onRetryDiff={retryGitDiff}
            onMode={(mode) => { actions.gitDiffModeSelected(tab.id, mode) }}
            onRatio={(ratio) => { actions.gitRatioChanged(tab.id, ratio) }}
            // The abort forgets the bucket before the unmount reports the offset.
            onScrolled={(scrollTop) => { if (!signal.aborted) actions.gitListScrolled(tab.id, scrollTop) }}
            ratio={state.git.ratio}
            onToggleGroup={(group) => { actions.gitGroupToggled(tab.id, group) }}
            t={t}
          />
        ) : (
          <SplitView
            ratio={state.ratio}
            onRatio={(ratio) => { actions.ratioChanged(tab.id, ratio) }}
            content={contentColumn}
            tree={treeColumn}
            label={t('splitter.aria')}
          />
        )}
        <WorkbenchRail
          items={state.git.failure
            || state.git.status?.kind === 'repository'
            || state.git.status?.kind === 'unavailable'
            ? [FILES_RAIL_ITEM, GIT_RAIL_ITEM]
            : [FILES_RAIL_ITEM]}
          selected={state.container}
          onSelect={(id) => { actions.containerSelected(tab.id, id) }}
          t={t}
        />
      </div>
    </div>
  )
}
