/**
 * The workbench's git view: the working tree's changed paths grouped by what
 * git reports, and the selected path's comparison with `HEAD`.
 *
 * Presentational — the body owns the reads and the store, this panel draws the
 * states each of them can be in and hands gestures back. The comparison is
 * rendered with the shared `DiffHunks`, the same diff surface the project's
 * change review uses. The wide layout keeps the comparison and the changed-path
 * list side by side; below the measured narrow threshold the list and the
 * comparison become one column with the comparison as a drill-down.
 */
import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import clsx from 'clsx'
import {
  Button, DiffHunks, FileTypeIcon, IconBranchOutlineRegular, IconCheckCircleFillRegular,
  IconChevronDownOutlineRegular, IconChevronLeftOutlineRegular, IconChevronRightOutlineRegular,
  IconRefreshOutlineRegular, IconWarningOutlineRegular, Tooltip, classifyFileType, focusWithoutRing,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { WorkspaceGitEntry } from '@deepseek-ai/dsh-workspace-changes/types'
import type {} from './locales.ts'
import type { GitTabState } from './store.ts'
import css from './FilesBody.module.css'
import gitCss from './GitPanel.module.css'
import { SplitView } from './SplitView.tsx'
import { DiffModeControl } from './DiffModeControl.tsx'
import { useScrollRestore } from './use-scroll-restore.ts'

/** The panel's props: the git slice, the gestures, and translate. */
export interface GitPanelProps {
  /** The tab's git slice. */
  readonly git: GitTabState
  /** Whether the measured panel is narrow and draws one column. */
  readonly narrow: boolean
  /** Show one changed path's comparison. */
  readonly onSelect: (entry: WorkspaceGitEntry) => void
  /** Open the narrow layout's comparison drill-down. */
  readonly onDrillDown: () => void
  /** Leave the narrow drill-down and go back to the changed-path list. */
  readonly onBack: () => void
  /** Read the working tree again. */
  readonly onReload: () => void
  /** Read the shown path's comparison again. */
  readonly onRetryDiff: () => void
  /** Choose the comparison layout. */
  readonly onMode: (mode: 'unified' | 'split') => void
  /** Settle where a drag left the two columns. */
  readonly onRatio: (ratio: number) => void
  /** Record where the changed-path list is scrolled to, on unmount. */
  readonly onScrolled: (scrollTop: number) => void
  /** Open or fold one changed-path group. */
  readonly onToggleGroup: (group: 'changed' | 'untracked') => void
  /** The comparison column's share of the view. */
  readonly ratio: number
  readonly t: TranslateNS<'sidebarFiles'>
}

/** One status letter per entry kind, as git's own shorthand. */
const LETTER: Readonly<Record<string, string>> = {
  added: 'A',
  deleted: 'D',
  modified: 'M',
  renamed: 'R',
  untracked: 'U',
}

/** One changed path: its status letter, name, containing directory, and selection. */
function EntryRow({ entry, selected, onSelect }: {
  readonly entry: WorkspaceGitEntry
  readonly selected: string | undefined
  readonly onSelect: (entry: WorkspaceGitEntry) => void
}): ReactNode {
  // A split path always has a last segment, even for a one-segment display.
  const parts = entry.display.split('/')
  const name = parts[parts.length - 1] as string
  const directory = parts.slice(0, -1).join('/')
  return (
    <button
      type="button"
      className={clsx(css.gitRow, css[`gitRow_${entry.kind}`], entry.path === selected && css.gitRowActive)}
      aria-current={entry.path === selected ? 'true' : undefined}
      data-files-git-entry={entry.path}
      data-files-git-kind={entry.kind}
      onClick={() => { onSelect(entry) }}
    >
      <span className={css.gitLetter}>{LETTER[entry.kind]}</span>
      <span className={css.gitName}>{name}</span>
      <span className={css.gitPath}>{directory}</span>
    </button>
  )
}

/** One group of changed paths with its open state and count. */
function ChangeGroup({ group, label, entries, open, onToggle, onSelect, selected }: {
  readonly group: 'changed' | 'untracked'
  readonly label: string
  readonly entries: readonly WorkspaceGitEntry[]
  readonly open: boolean
  readonly onToggle: (group: 'changed' | 'untracked') => void
  readonly onSelect: (entry: WorkspaceGitEntry) => void
  readonly selected: string | undefined
}): ReactNode {
  if (entries.length === 0) return null
  return (
    <div className={css.gitGroup} data-files-git-group={group}>
      <button
        type="button"
        className={css.gitGroupTitle}
        aria-expanded={open}
        data-files-git-group-toggle={group}
        onClick={() => { onToggle(group) }}
      >
        {open ? <IconChevronDownOutlineRegular /> : <IconChevronRightOutlineRegular />}
        {label} <span className={css.gitCount}>{entries.length}</span>
      </button>
      {open && entries.map(entry => (
        <EntryRow key={entry.path} entry={entry} selected={selected} onSelect={onSelect} />
      ))}
    </div>
  )
}

/** The filled, centered clean state shared by the list and the comparison. */
function CleanState({ t, stateAttr }: {
  readonly t: TranslateNS<'sidebarFiles'>
  readonly stateAttr: 'data-files-git-state' | 'data-files-git-diff-state'
}): ReactNode {
  return (
    <div className={gitCss.cleanState} {...{ [stateAttr]: 'clean' }}>
      <IconCheckCircleFillRegular className={gitCss.cleanIcon} />
      <p className={gitCss.cleanTitle}>{t('git.clean')}</p>
      <p className={gitCss.cleanDetail}>{t('git.clean.detail')}</p>
    </div>
  )
}

/** The list column: the panel header above the scrolling groups and their rows. */
function ChangedPaths({ git, narrow, onSelect, onReload, onToggleGroup, onScrolled, t }: GitPanelProps): ReactNode {
  // The panel unmounts when the reader switches containers, so the offset is
  // restored on mount and reported once on unmount rather than per scroll.
  const { scrollRef: listRef, scrollTopRef } = useScrollRestore(git.scrollTop, onScrolled)
  const status = git.status
  const entries = status?.entries ?? []
  const changed = entries.filter(entry => entry.kind !== 'untracked')
  const untracked = entries.filter(entry => entry.kind === 'untracked')
  const clean = status?.kind === 'repository' && entries.length === 0 && !git.failure
  return (
    <>
      {/* The column's top bar stays above the scroller: a long changed-path
          list scrolls under it instead of carrying it away. */}
      <div className={css.gitHeader} data-files-git-header>
        <span className={css.gitTitle} data-files-git-title>{t('git.title')}</span>
        {status?.kind === 'repository' && status.branch !== undefined && (
          <span className={gitCss.branchChip} data-files-git-branch>
            <IconBranchOutlineRegular />
            <span className={gitCss.branchName}>{status.branch}</span>
          </span>
        )}
        <span className={gitCss.headerSpacer} />
        <Tooltip label={t('git.refresh')} side="bottom" delayMs={300}>
          <button
            type="button"
            className={css.tool}
            aria-label={t('git.refresh')}
            data-files-git-refresh
            onClick={onReload}
          >
            <IconRefreshOutlineRegular />
          </button>
        </Tooltip>
      </div>
      {status?.kind === 'repository' && (
        <div className={gitCss.summary} data-files-git-summary>
          <span>{t('git.summary.files', { count: status.total })}</span>
          <span
            className={clsx(gitCss.sync, git.failure && gitCss.syncFailed)}
            data-files-git-sync={git.failure ? 'failed' : 'synced'}
          >
            <span className={gitCss.syncDot} />
            {git.failure ? t('git.summary.failed') : t('git.summary.synced')}
          </span>
        </div>
      )}
      <div
        ref={listRef}
        className={css.gitList}
        data-files-git-list
        onScroll={(event) => { scrollTopRef.current = event.currentTarget.scrollTop }}
      >
        {status === undefined || status.kind === 'unavailable'
          ? (
            <div className={css.gitNoteRow} data-files-git-state={git.loading ? 'loading' : 'failed'}>
              <span>{git.loading ? t('git.loading') : t('git.failed')}</span>
              {!git.loading && <Button size="sm" data-files-git-retry onClick={onReload}>{t('retry')}</Button>}
            </div>
          )
          : status.kind === 'not-a-repository'
            ? null
            : (
              <>
                {/* A reload that failed leaves the last list on screen; the
                    banner says it is stale and offers the retry. */}
                {git.failure && (
                  <div className={clsx(css.gitNoteRow, gitCss.banner)} data-files-git-state="failed">
                    <IconWarningOutlineRegular className={gitCss.bannerIcon} />
                    <span>{t('git.failed')}</span>
                    <Button size="sm" data-files-git-retry onClick={onReload}>{t('retry')}</Button>
                  </div>
                )}
                {clean
                  ? (narrow
                    ? <CleanState t={t} stateAttr="data-files-git-state" />
                    : <p className={css.gitNote} data-files-git-state="clean">{t('git.clean')}</p>)
                  : (
                    <>
                      <ChangeGroup group="changed" label={t('git.changes')} entries={changed}
                        open={git.groups.changed} onToggle={onToggleGroup} onSelect={onSelect} selected={git.selected} />
                      <ChangeGroup group="untracked" label={t('git.untracked')} entries={untracked}
                        open={git.groups.untracked} onToggle={onToggleGroup} onSelect={onSelect} selected={git.selected} />
                      {status.total > entries.length && (
                        <p className={css.gitNote} data-files-git-truncated>
                          {t('git.truncated', { shown: entries.length, total: status.total })}
                        </p>
                      )}
                    </>
                  )}
              </>
            )}
      </div>
    </>
  )
}

/** The diff column: the selected path's comparison in its states. */
function Comparison(props: GitPanelProps): ReactNode {
  const { git, t, onMode, onRetryDiff } = props
  const diff = git.diff
  if (git.status?.kind === 'repository' && git.status.entries.length === 0 && !git.failure) {
    return (
      <div className={gitCss.fill} data-files-git-diff-state="clean">
        <CleanState t={t} stateAttr="data-files-git-diff-state" />
      </div>
    )
  }
  if (git.selected === undefined) {
    return (
      <div className={gitCss.fill} data-files-git-diff-state="none">
        <p className={css.gitNote}>{t('git.diff.none')}</p>
      </div>
    )
  }
  if (diff === undefined || diff === 'loading') {
    return <p className={css.gitNote} data-files-git-diff-state="loading">{t('git.diff.loading')}</p>
  }
  if (diff === 'failed') {
    return (
      <div className={css.gitNoteRow} data-files-git-diff-state="failed">
        <span>{t('git.diff.failed')}</span>
        <Button size="sm" data-files-git-diff-retry onClick={onRetryDiff}>{t('retry')}</Button>
      </div>
    )
  }
  return (
    <div className={css.gitDiff} data-files-git-diff={diff.path}>
      <div className={css.gitDiffHeader}>
        <FileTypeIcon kind={classifyFileType(diff.path)} size={14} className={gitCss.diffIcon} />
        <span className={css.gitDiffPath}>{diff.display}</span>
        <DiffModeControl mode={git.diffMode} onMode={onMode} dataAttr="data-files-git-diff-mode" t={t} />
      </div>
      {diff.kind === 'binary'
        ? <p className={css.gitNote} data-files-git-diff-state="binary">{t('git.diff.binary')}</p>
        : diff.kind === 'oversized'
          ? <p className={css.gitNote} data-files-git-diff-state="oversized">{t('git.diff.oversized')}</p>
          : diff.hunks.length === 0
            ? <p className={css.gitNote} data-files-git-diff-state="empty">{t('git.diff.empty')}</p>
            : (
              <DiffHunks
                path={diff.path}
                hunks={diff.hunks}
                split={git.diffMode === 'split'}
                splitOneSided
                note={diff.before ? undefined : t('git.diff.created')}
                coarse={diff.coarse}
                /* v8 ignore next -- the truncated note needs a comparison past the 5000-line cap. */
                labels={{ coarse: t('diff.coarse'), truncated: count => t('diff.truncated', { count }) }}
              />
            )}
    </div>
  )
}

/**
 * Render the git view: the comparison leads and the changed-path list trails
 * in the wide layout; below the measured threshold the two become one column
 * with the comparison as a drill-down.
 * @param props - the git slice, its gestures, and translate.
 * @returns the measured panel.
 */
export function GitPanel(props: GitPanelProps): ReactNode {
  const { git, narrow, t } = props
  const root = useRef<HTMLDivElement | null>(null)
  // A narrow pick is the comparison drill-down; the wide layout draws both
  // columns, so selecting there records nothing for a later resize.
  const pageOpen = narrow && git.pageOpen && git.selected !== undefined
  const selectEntry = (entry: WorkspaceGitEntry): void => {
    props.onSelect(entry)
    if (narrow) props.onDrillDown()
  }
  // Both narrow transitions unmount the control that held the keyboard. Focus
  // follows the view: the back control when the comparison opens, and the row
  // it came from when the list returns.
  const wasPageOpen = useRef(pageOpen)
  useEffect(() => {
    const previous = wasPageOpen.current
    wasPageOpen.current = pageOpen
    if (previous === pageOpen) return
    const selector = pageOpen
      ? '[data-files-git-back]'
      : `[data-files-git-entry="${git.selected}"]`
    const target = root.current?.querySelector<HTMLElement>(selector)
    if (target != null) focusWithoutRing(target)
  }, [pageOpen, git.selected])
  const list = <ChangedPaths {...props} onSelect={selectEntry} />
  const content = (
    <div className={css.gitCompare} data-files-git-compare>
      <Comparison {...props} />
    </div>
  )
  return (
    <div
      ref={root}
      className={clsx(css.gitPanel, gitCss.panel)}
      data-files-git-panel
      data-files-git-layout={narrow ? 'narrow' : 'wide'}
      data-files-git-page-open={pageOpen ? 'true' : 'false'}
    >
      {narrow
        ? (pageOpen
          ? (
            <div className={gitCss.singlePane}>
              <div className={gitCss.backBar}>
                <button
                  type="button"
                  className={gitCss.back}
                  data-files-git-back
                  onClick={props.onBack}
                >
                  <IconChevronLeftOutlineRegular />
                  <span>{t('git.back')}</span>
                </button>
              </div>
              {content}
            </div>
          )
          : <div className={gitCss.singlePane}>{list}</div>)
        : (
          <SplitView
            ratio={props.ratio}
            onRatio={props.onRatio}
            content={content}
            tree={list}
            label={t('splitter.git.aria')}
          />
        )}
    </div>
  )
}
