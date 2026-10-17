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
  IconPauseOutlineRegular, IconPlayOutlineRegular, IconRefreshOutlineRegular, PathLabel, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  PropsLocale, PropsRenderFactories, PropsRenderSlots, PropsRuntime, PropsStore,
} from '@deepseek-ai/dsh-client-ui-slots'
import { fileAddressFor, pathPartsOf } from '@deepseek-ai/dsh-util-workspace-path'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/client'
import type { FilesInjected } from './face.ts'
import { FileTabs } from './FileTabs.tsx'
import type {} from './locales.ts'
import { SplitView } from './SplitView.tsx'
import type { createFilesStore, OpenFile } from './store.ts'
import { TreeList } from './tree.tsx'
import type { TreeContext } from './tree.tsx'
import css from './FilesBody.module.css'

/** The body's composed props: the tab it draws, its store, its face, its copy, and the preview Factory. */
export type FilesBodyProps =
  & PropsRuntime<'sidebar.right.pane.tab'>
  & PropsRenderSlots<'sidebar.right.tab.files.actions'>
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
  start, refresh, setAutoRefresh, toggle, reveal, chipSignal, chipsClosed, t,
}: FilesBodyProps): ReactNode {
  const { tab } = useTabInfo()
  useEffect(() => tab.actions.bindCommands({ refresh: () => { refresh(tab.id) } }), [tab.actions, tab.id, refresh])
  const { signal } = tab
  const cwd = useSessions(sessions => sessions.byId[sessionId]?.cwd)
  const state = useStore(store => store.byTab[tab.id])
  const bodyRef = useRef<HTMLDivElement>(null)
  const scrollTopRef = useRef(0)
  // Come back where the reader was: loaded levels outlive the body in the
  // store, so a remounted tree lays out at its full height before this runs
  // and the stored offset re-lands exactly. A fresh tree stores 0.
  const seeded = state !== undefined
  useLayoutEffect(() => {
    const body = bodyRef.current
    if (seeded && body !== null) {
      body.scrollTop = state.scrollTop
      scrollTopRef.current = body.scrollTop
    }
  }, [seeded])
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
  }, [state, cwd, tab.id, signal, start])

  // Bring the row a reveal landed on into view once the tree lists it. A row
  // already in view moves nothing, so repeated commits settle here without a
  // jump; the row appearing is what re-runs this, not a second reveal request.
  // The handled token is remembered so a directory reload — which changes
  // `levels` and would otherwise re-run this — does not scroll away from where
  // the reader has moved since the reveal.
  const revealedTokenRef = useRef(-1)
  useLayoutEffect(() => {
    const revealed = state?.revealed
    const body = bodyRef.current
    if (revealed === undefined || body === null || revealedTokenRef.current === revealed.token) return
    const row = [...body.querySelectorAll<HTMLElement>('[data-files-path]')]
      .find(node => node.dataset.filesPath === revealed.path)
    if (row === undefined) return
    revealedTokenRef.current = revealed.token
    const box = body.getBoundingClientRect()
    const rect = row.getBoundingClientRect()
    if (rect.top >= box.top && rect.bottom <= box.bottom) return
    body.scrollTop += rect.top - box.top
  }, [state?.revealed?.token, state?.levels])
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
          onClose={path => close([path], () => { actions.fileClosed(tab.id, path) })}
          onCloseOthers={path => close(
            value.open.map(open => open.path).filter(open => open !== path),
            () => { actions.filesClosedExcept(tab.id, path) },
          )}
          onCloseAll={() => close(value.open.map(open => open.path), () => { actions.filesClosedAll(tab.id) })}
          onCloseLeft={(path) => {
            const at = value.open.findIndex(open => open.path === path)
            close(value.open.slice(0, Math.max(at, 0)).map(open => open.path), () => { actions.filesClosedBefore(tab.id, path) })
          }}
          onCloseRight={(path) => {
            const at = value.open.findIndex(open => open.path === path)
            close(value.open.slice(at + 1).map(open => open.path), () => { actions.filesClosedAfter(tab.id, path) })}
          }
          onReveal={(path) => { reveal(tab.id, value.root, path, value.expanded, signal) }}
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
  }, [state?.open, state?.active, state?.expanded, state?.root, actions, tab.id, signal,
    chipSignal, chipsClosed, t, renderFactorySlot, reveal])
  const treeColumn = useMemo((): ReactNode => tree === undefined ? null : (
    <div
      ref={bodyRef}
      className={css.body}
      data-files-body
      onScroll={(event) => { scrollTopRef.current = event.currentTarget.scrollTop }}
    >
      <TreeList {...tree} />
    </div>
  ), [tree])

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
      <SplitView
        ratio={state.ratio}
        onRatio={(ratio) => { actions.ratioChanged(tab.id, ratio) }}
        content={contentColumn}
        tree={treeColumn}
        label={t('splitter.aria')}
      />
    </div>
  )
}
