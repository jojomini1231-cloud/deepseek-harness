/**
 * The workbench's git view: the working tree's changed paths grouped by what
 * git reports, and the selected path's comparison with `HEAD`.
 *
 * Presentational — the body owns the reads and the store, this panel draws the
 * states each of them can be in and hands gestures back. The comparison is
 * rendered with the shared `DiffHunks`, the same diff surface the project's
 * change review uses.
 *
 * `LayoutControl` is its own two-button group rather than the shared
 * `SegmentedControl`: a segmented control is a tablist whose options select
 * panels, while here both buttons describe one comparison that stays on screen.
 */
import { useCallback, useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import clsx from 'clsx'
import {
  Button, DiffHunks, IconChevronDownOutlineRegular, IconChevronRightOutlineRegular, IconRefreshOutlineRegular, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { WorkspaceGitEntry } from '@deepseek-ai/dsh-workspace-changes/types'
import type {} from './locales.ts'
import type { GitTabState } from './store.ts'
import css from './FilesBody.module.css'
import { SplitView } from './SplitView.tsx'

/** The panel's props: the git slice, the gestures, and translate. */
export interface GitPanelProps {
  /** The tab's git slice. */
  readonly git: GitTabState
  /** Show one changed path's comparison. */
  readonly onSelect: (entry: WorkspaceGitEntry) => void
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

/** The list column: the panel header, the groups, and their rows. */
function ChangedPaths({ git, onSelect, onReload, onToggleGroup, onScrolled, t }: GitPanelProps): ReactNode {
  const scrollTopRef = useRef(git.scrollTop)
  const reportScrolled = useRef(onScrolled)
  useEffect(() => { reportScrolled.current = onScrolled }, [onScrolled])
  // The panel unmounts when the reader switches containers, so the offset is
  // restored on mount and reported once on unmount rather than per scroll.
  const listRef = useCallback((node: HTMLDivElement | null) => {
    if (node !== null) node.scrollTop = scrollTopRef.current
  }, [])
  useEffect(() => () => { reportScrolled.current(scrollTopRef.current) }, [])
  const status = git.status
  const entries = status?.entries ?? []
  const changed = entries.filter(entry => entry.kind !== 'untracked')
  const untracked = entries.filter(entry => entry.kind === 'untracked')
  return (
    <div
      ref={listRef}
      className={css.gitList}
      data-files-git-list
      onScroll={(event) => { scrollTopRef.current = event.currentTarget.scrollTop }}
    >
      <div className={css.gitHeader} data-files-git-header>
        <span className={css.gitTitle} data-files-git-title>{t('git.title')}</span>
        {status?.kind === 'repository' && status.branch !== undefined && (
          <span className={css.gitBranch} data-files-git-branch>{status.branch}</span>
        )}
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
                <div className={css.gitNoteRow} data-files-git-state="failed">
                  <span>{t('git.failed')}</span>
                  <Button size="sm" data-files-git-retry onClick={onReload}>{t('retry')}</Button>
                </div>
              )}
              {entries.length === 0
                ? (git.failure ? null : <p className={css.gitNote} data-files-git-state="clean">{t('git.clean')}</p>)
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
  )
}

/**
 * The layout control: one unified column, or both sides.
 * @param props - the shown layout and the pick gesture.
 * @returns the two segmented buttons.
 */
function LayoutControl({ mode, onMode, t }: { mode: 'unified' | 'split'; onMode: (mode: 'unified' | 'split') => void } & { t: GitPanelProps['t'] }): ReactNode {
  return (
    <div className={css.gitMode} role="group" aria-label={t('diff.mode.aria')}>
      {(['unified', 'split'] as const).map(choice => (
        <button
          key={choice}
          type="button"
          className={clsx(css.gitModeButton, choice === mode && css.gitModeActive)}
          aria-pressed={choice === mode}
          data-files-git-diff-mode={choice}
          onClick={() => { onMode(choice) }}
        >
          {t(choice === 'unified' ? 'diff.mode.unified' : 'diff.mode.split')}
        </button>
      ))}
    </div>
  )
}

/** The diff column: the selected path's comparison in its states. */
function Comparison(props: GitPanelProps): ReactNode {
  const { git, t, onMode, onRetryDiff } = props
  const diff = git.diff
  if (git.selected === undefined) {
    // A clean tree states it once, in the list; the comparison column stays empty.
    if (git.status?.kind === 'repository' && git.status.entries.length === 0) return null
    return <p className={css.gitNote} data-files-git-diff-state="none">{t('git.diff.none')}</p>
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
        <span className={css.gitDiffPath}>{diff.display}</span>
        <LayoutControl mode={git.diffMode} onMode={onMode} t={t} />
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
 * Render the git view: the selected path's comparison leads, the changed-path
 * list trails.
 * @param props - the git slice, its gestures, and translate.
 * @returns the comparison column and the changed-path list.
 */
export function GitPanel(props: GitPanelProps): ReactNode {
  return (
    <div className={css.gitPanel} data-files-git-panel>
      <SplitView
        ratio={props.ratio}
        onRatio={props.onRatio}
        content={(
          <div className={css.gitCompare} data-files-git-compare>
            <Comparison {...props} />
          </div>
        )}
        tree={<ChangedPaths {...props} />}
        label={props.t('splitter.git.aria')}
      />
    </div>
  )
}
