/**
 * The history view: the commit navigator on the trailing side and, in the wide
 * layout, the selected commit's page on the leading one; in a narrow layout the
 * page is a drill-down with a back control instead, decided from the panel's
 * measured width rather than a window media query.
 *
 * Presentational — the body owns the reads and the store. The navigator's refs
 * filter only changes which history the list walks; it never switches branches.
 * Rows carry one inline commit graph computed by the pure lane layout in
 * `history-graph.ts`: each row draws the lane segments that cross it and its
 * commit dot, so a fork or a merge shows as a diagonal while a lane that keeps
 * its place draws straight, and every row shares one gutter width.
 */
import { memo, useCallback, useEffect, useMemo, useRef } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import clsx from 'clsx'
import {
  Button, IconRefreshOutlineRegular, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { WorkspaceGitCommit, WorkspaceGitRef } from '@deepseek-ai/dsh-workspace-changes/types'
import type {} from './locales.ts'
import type { HistoryTabState } from './store.ts'
import { CommitPage } from './CommitPage.tsx'
import type { DiffMode } from './DiffModeControl.tsx'
import { useDrillDownFocus } from './drill-down-focus.ts'
import { HistoryRefsFilter } from './HistoryRefsFilter.tsx'
import { useScrollRestore } from './use-scroll-restore.ts'
import { RefPills } from './RefPills.tsx'
import { SplitView } from './SplitView.tsx'
import { useNarrowLayout } from './layout.ts'
import { useNow } from './use-now.ts'
import { absoluteTime, commitRefPills, historyTime, refsByCommit } from './history.ts'
import { layoutGraph } from './history-graph.ts'
import type { GraphLayout, GraphRow } from './history-graph.ts'
import bodyCss from './FilesBody.module.css'
import css from './HistoryPanel.module.css'

/** A commit row's height in px; the commit graph draws in the same unit. */
const ROW_HEIGHT = 44

/** A lane's distance from the gutter's leading edge, in px. */
const LANE_PAD = 8

/** The distance between two adjacent lanes, in px. */
const LANE_SPACING = 9

/** Ref names a commit row names before the `+n` pill. */
const ROW_REF_LIMIT = 2

/** The refs a commit without any tips carries; one instance, so a row's memo holds. */
const NO_REFS: readonly WorkspaceGitRef[] = []

/**
 * The x coordinate a lane's line draws at.
 * @param lane - zero-based lane index from the gutter's leading edge.
 * @returns the coordinate in px.
 */
function laneX(lane: number): number {
  return LANE_PAD + lane * LANE_SPACING
}

/**
 * The gutter width a lane count needs. The navigator publishes this one width
 * for every row, so row text starts at the same edge whatever a row draws.
 * @param lanes - the widest row's lane count; 0 for an empty page.
 * @returns the width in px.
 */
function gutterWidth(lanes: number): number {
  return LANE_PAD * 2 + (Math.max(1, lanes) - 1) * LANE_SPACING
}

/** The history view's props: the slice, the gestures, and translate. */
export interface HistoryPanelProps {
  /** The tab's history slice. */
  readonly history: HistoryTabState
  /** The working tree's changed-file count, drawn as the list's first row. */
  readonly dirtyCount: number
  /** Walk one ref, or `HEAD` when undefined. */
  readonly onSelectRef: (ref: string | undefined) => void
  /** Read the refs and the shown history again. */
  readonly onRefresh: () => void
  /** Read the refs again from the filter's failed state. */
  readonly onRetryRefs: () => void
  /** Ask for the next page of commits. */
  readonly onLoadMore: () => void
  /** Read the shown history page again. */
  readonly onRetryList: () => void
  /** Show one commit's page. */
  readonly onSelectCommit: (hash: string) => void
  /** Open the narrow layout's drill-down; only the narrow layout reports it. */
  readonly onDrillDown: () => void
  /** Switch to the working-tree git view. */
  readonly onDirty: () => void
  /** Show one changed file's comparison. */
  readonly onSelectFile: (path: string) => void
  /** Open or fold the changed-file section. */
  readonly onToggleFiles: () => void
  /** Read the selected commit's page again. */
  readonly onRetryDetail: () => void
  /** Read the selected file's comparison again. */
  readonly onRetryDiff: () => void
  /** Choose the comparison layout. */
  readonly onDiffMode: (mode: DiffMode) => void
  /** Settle where a drag left the two columns. */
  readonly onRatio: (ratio: number) => void
  /** Leave the narrow drill-down and go back to the list. */
  readonly onBack: () => void
  /** Record where the commit list is scrolled to, on unmount. */
  readonly onListScrolled: (scrollTop: number) => void
  /** Record where the commit page is scrolled to, for the commit it draws. */
  readonly onPageScrolled: (hash: string, scrollTop: number) => void
  readonly t: TranslateNS<'sidebarFiles'>
}

/**
 * One row's commit-graph gutter: every lane segment crossing the row, the
 * commit's dot, and the shown commit's ring. A segment runs between the lane it
 * occupied above the row and the one it occupies below, so a lane that keeps
 * its place draws vertically and a fork or merge draws a diagonal.
 * @param props.row - the row's graph drawing.
 * @param props.lanes - the layout's widest lane count; fixes the gutter width.
 * @param props.active - whether the row is the shown commit.
 * @returns the gutter, or nothing before the row's drawing is known.
 */
function GraphGutter({ row, lanes, active }: {
  readonly row: GraphRow | undefined
  readonly lanes: number
  readonly active: boolean
}): ReactNode {
  /* v8 ignore next -- the pure layout covers every loaded commit hash. */
  if (row === undefined) return null
  const width = gutterWidth(lanes)
  const centerY = ROW_HEIGHT / 2
  return (
    <svg
      className={css.gutter}
      width={width}
      height={ROW_HEIGHT}
      viewBox={`0 0 ${width} ${ROW_HEIGHT}`}
      aria-hidden="true"
    >
      {row.edges.map((edge, index) => (
        <line
          // Segments are positional: the drawing holds every crossing of the row.
          key={index}
          className={clsx(css.edge, css[`lane${edge.color}`])}
          x1={laneX(edge.fromLane)} y1={edge.from * ROW_HEIGHT}
          x2={laneX(edge.toLane)} y2={edge.to * ROW_HEIGHT}
        />
      ))}
      {active && (
        <circle
          className={clsx(css.ring, css[`lane${row.node.color}`])}
          cx={laneX(row.node.lane)} cy={centerY} r={6.5}
        />
      )}
      <circle
        className={clsx(css.node, css[`lane${row.node.color}`])}
        cx={laneX(row.node.lane)} cy={centerY} r={3}
      />
    </svg>
  )
}

/** One commit row: its commit-graph gutter, ref pills, subject, and identity line. */
const CommitRow = memo(function CommitRow({ commit, row, lanes, active, refs, now, onSelect, t }: {
  readonly commit: WorkspaceGitCommit
  readonly row: GraphRow | undefined
  readonly lanes: number
  readonly active: boolean
  readonly refs: readonly WorkspaceGitRef[]
  readonly now: number
  readonly onSelect: (hash: string) => void
  readonly t: HistoryPanelProps['t']
}): ReactNode {
  const pills = commitRefPills(refs, ROW_REF_LIMIT)
  return (
    <button
      type="button"
      className={clsx(css.commitRow, active && css.commitRowActive)}
      aria-current={active ? 'true' : undefined}
      data-files-history-commit={commit.hash}
      onClick={() => { onSelect(commit.hash) }}
    >
      <GraphGutter row={row} lanes={lanes} active={active} />
      <span className={css.commitMain}>
        <span className={css.commitLine1}>
          <RefPills pills={pills} className={css.refPills} pillClassName={css.refPill} labelClassName={css.refPillLabel} />
          <span className={css.commitSubject} data-files-history-subject>{commit.subject}</span>
        </span>
        <span className={css.commitLine2}>
          <span className={css.commitHash} data-files-history-commit-hash>{commit.short}</span>
          <span className={css.commitSep}>·</span>
          <span className={css.commitAuthor}>{commit.author}</span>
          <span className={css.commitSep}>·</span>
          <span className={css.commitTime} title={absoluteTime(commit.authoredAt, t)}>
            {historyTime(commit.authoredAt, now, t)}
          </span>
        </span>
      </span>
    </button>
  )
})

/** The navigator column: its header, refs filter, and commit list. */
function Navigator({
  history, dirtyCount, graph, tips, now, onSelectRef, onRefresh, onRetryRefs, onLoadMore, onRetryList,
  onSelectCommit, onDirty, onListScrolled, t,
}: {
  readonly history: HistoryTabState
  readonly dirtyCount: number
  readonly graph: GraphLayout
  readonly tips: ReadonlyMap<string, readonly WorkspaceGitRef[]>
  readonly now: number
  readonly onSelectRef: HistoryPanelProps['onSelectRef']
  readonly onRefresh: HistoryPanelProps['onRefresh']
  readonly onRetryRefs: HistoryPanelProps['onRetryRefs']
  readonly onLoadMore: HistoryPanelProps['onLoadMore']
  readonly onRetryList: HistoryPanelProps['onRetryList']
  readonly onSelectCommit: (hash: string) => void
  readonly onDirty: HistoryPanelProps['onDirty']
  readonly onListScrolled: HistoryPanelProps['onListScrolled']
  readonly t: HistoryPanelProps['t']
}): ReactNode {
  // The panel unmounts when the reader switches containers, so the offset is
  // restored on mount and reported once on unmount rather than per scroll.
  const { scrollRef: setList, elementRef: list, scrollTopRef } = useScrollRestore(history.listScrollTop, onListScrolled)
  // Walking another ref starts a fresh list: its scroller goes back to the top
  // rather than keeping the offset of the history that was just replaced.
  const previousRef = useRef(history.ref)
  useEffect(() => {
    if (previousRef.current === history.ref) return
    previousRef.current = history.ref
    scrollTopRef.current = 0
    /* v8 ignore next -- the header that walks another ref only renders with its list. */
    if (list.current !== null) list.current.scrollTop = 0
  }, [history.ref])

  const refsPending = history.refs === undefined && !history.refsFailure
  let rows: ReactNode
  if (history.commits.length === 0) {
    if (history.refsFailure && history.refs === undefined) {
      rows = (
        <div className={css.noteRow} data-files-history-state="refs-failed">
          <span>{t('history.refs.failed')}</span>
          <Button size="sm" data-files-history-refs-retry onClick={onRetryRefs}>{t('retry')}</Button>
        </div>
      )
    } else if (refsPending || history.loading) {
      rows = <p className={css.note} data-files-history-state="loading">{t('history.loading')}</p>
    } else if (history.failure) {
      rows = (
        <div className={css.noteRow} data-files-history-state="failed">
          <span>{t('history.failed')}</span>
          <Button size="sm" data-files-history-retry onClick={onRetryList}>{t('retry')}</Button>
        </div>
      )
    } else {
      rows = <p className={css.note} data-files-history-state="empty">{t('history.empty')}</p>
    }
  } else {
    rows = (
      <>
        {/* A reload that failed leaves the loaded pages on screen; the banner
            says they are stale and offers the retry. */}
        {history.failure && (
          <div className={css.noteRow} data-files-history-state="failed">
            <span>{t('history.failed')}</span>
            <Button size="sm" data-files-history-retry onClick={onRetryList}>{t('retry')}</Button>
          </div>
        )}
        {dirtyCount > 0 && history.ref === undefined && (
          <button type="button" className={css.dirtyRow} data-files-history-dirty onClick={onDirty}>
            <span className={css.dirtyDot} />
            <span>{t('history.dirty')}</span>
            <span className={css.dirtyCount}>{t('history.dirty.count', { count: dirtyCount })}</span>
          </button>
        )}
        {history.commits.map(commit => (
          <CommitRow
            key={commit.hash}
            commit={commit}
            row={graph.rows.get(commit.hash)}
            lanes={graph.lanes}
            active={commit.hash === history.selected}
            refs={tips.get(commit.hash) ?? NO_REFS}
            now={now}
            onSelect={onSelectCommit}
            t={t}
          />
        ))}
        {history.hasMore && (
          <button
            type="button"
            className={css.loadMore}
            data-files-history-load
            disabled={history.loading}
            onClick={onLoadMore}
          >
            {t('history.loadMore')}
          </button>
        )}
      </>
    )
  }
  return (
    <div className={css.navigator} data-files-history-navigator>
      <div className={css.navHeader}>
        <span className={css.navTitle} data-files-history-title>{t('history.title')}</span>
        <span className={css.navSpacer} />
        <HistoryRefsFilter
          refs={history.refs}
          refsFailure={history.refsFailure}
          selected={history.ref}
          onSelect={onSelectRef}
          onRetry={onRetryRefs}
          t={t}
        />
        <Tooltip label={t('history.refresh')} side="bottom" delayMs={300}>
          <button
            type="button"
            className={bodyCss.tool}
            aria-label={t('history.refresh')}
            data-files-history-refresh
            onClick={onRefresh}
          >
            <IconRefreshOutlineRegular />
          </button>
        </Tooltip>
      </div>
      <div
        ref={setList}
        className={css.commitList}
        data-files-history-list
        onScroll={(event) => { scrollTopRef.current = event.currentTarget.scrollTop }}
      >
        {rows}
      </div>
    </div>
  )
}

/**
 * Render the history view: the commit page leads and the navigator trails in
 * the wide layout; below the measured threshold the two become one column with
 * the page as a drill-down.
 * @param props - the history slice, its gestures, and translate.
 * @returns the measured panel.
 */
export function HistoryPanel(props: HistoryPanelProps): ReactNode {
  const { history, dirtyCount, ...hands } = props
  // The threshold is the panel's own measured width, not the window's: the
  // right Sidebar is resizable and the same window holds both layouts.
  const { root, setRoot, narrow } = useNarrowLayout()
  const now = useNow()
  const graph = useMemo(() => layoutGraph(history.commits), [history.commits])
  // The row height and the one gutter width are published to the stylesheet:
  // the rows and the graph drawings both consume them, so the drawing can never
  // disagree with the box it sits in and no row's text starts at another edge.
  const panelStyle = useMemo(() => ({
    '--files-history-row-height': `${ROW_HEIGHT}px`,
    '--files-history-gutter-width': `${gutterWidth(graph.lanes)}px`,
  }) as CSSProperties, [graph.lanes])
  const tips = useMemo(() => refsByCommit(history.refs ?? []), [history.refs])
  const pageOpen = narrow && history.pageOpen && history.selected !== undefined
  // Both narrow transitions unmount the control that held the keyboard, which
  // would otherwise leave focus on the page body and restart the next Tab at
  // the top of the document. The flip hands focus to the control its own state
  // names: the drill-down's back control as the page opens, and the row it came
  // from when the list returns. A refresh that dropped the selected commit
  // leaves no row to return to, so the refs chip takes the focus instead.
  useDrillDownFocus(root, pageOpen, narrow, (panel, open) => {
    if (open) return panel.querySelector<HTMLElement>('[data-files-history-back]')
    const rows = panel.querySelectorAll<HTMLElement>('[data-files-history-commit]')
    const row = history.selected === undefined
      ? undefined
      : [...rows].find(candidate => candidate.dataset.filesHistoryCommit === history.selected)
    return row ?? panel.querySelector<HTMLElement>('[data-files-history-refs]')
  })
  // Only a narrow pick is a drill-down: the wide layout draws the page beside
  // the list, so recording the drill-down state there would open it on a later
  // resize for a commit the reader never drilled into. The row handler is held
  // still across renders — the body rebuilds its hands on every store write,
  // and a fresh handler would re-render every loaded row through the memo.
  const latest = useRef(hands)
  useEffect(() => { latest.current = hands })
  const selectCommit = useCallback((hash: string): void => {
    latest.current.onSelectCommit(hash)
    // A narrow pick is the drill-down; the wide layout draws the page beside
    // the list, so recording it there would open one the reader never chose.
    if (narrow) latest.current.onDrillDown()
  }, [narrow])
  const back = useCallback((): void => {
    latest.current.onBack()
  }, [])
  const page = (
    <CommitPage
      key={history.selected ?? 'none'}
      history={history}
      narrow={narrow}
      tips={tips}
      now={now}
      onBack={back}
      onSelectFile={hands.onSelectFile}
      onToggleFiles={hands.onToggleFiles}
      onRetryDetail={hands.onRetryDetail}
      onRetryDiff={hands.onRetryDiff}
      onDiffMode={hands.onDiffMode}
      onScrolled={hands.onPageScrolled}
      t={hands.t}
    />
  )
  const navigator = (
    <Navigator
      history={history}
      dirtyCount={dirtyCount}
      graph={graph}
      tips={tips}
      now={now}
      onSelectRef={hands.onSelectRef}
      onRefresh={hands.onRefresh}
      onRetryRefs={hands.onRetryRefs}
      onLoadMore={hands.onLoadMore}
      onRetryList={hands.onRetryList}
      onSelectCommit={selectCommit}
      onDirty={hands.onDirty}
      onListScrolled={hands.onListScrolled}
      t={hands.t}
    />
  )
  return (
    <div
      ref={setRoot}
      className={css.panel}
      style={panelStyle}
      data-files-history
      data-files-history-layout={narrow ? 'narrow' : 'wide'}
      data-files-history-page-open={pageOpen ? 'true' : 'false'}
    >
      {narrow
        ? (pageOpen ? page : navigator)
        : (
          <SplitView
            ratio={history.ratio}
            onRatio={hands.onRatio}
            content={page}
            tree={navigator}
            label={hands.t('history.splitter.aria')}
          />
        )}
    </div>
  )
}
