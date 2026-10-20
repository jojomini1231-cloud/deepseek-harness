/**
 * One commit's page: its message, the changed-file section folded into the
 * page, and the selected file's comparison with the commit's first parent.
 *
 * The page is a flex column: the header, meta, message, and file list take
 * their own height, and the comparison takes what is left with its own
 * internal scroll, so a one-line change fills the column instead of leaving
 * half of it empty. Folding the file list therefore hands the comparison more
 * room. Presentational — the body owns the reads and the store.
 */
import { useState } from 'react'
import type { ReactNode } from 'react'
import clsx from 'clsx'
import {
  Button, DiffHunks, IconChevronDownOutlineRegular, IconChevronLeftOutlineRegular, IconChevronRightOutlineRegular,
  PathLabel,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { WorkspaceGitCommit, WorkspaceGitCommitFile, WorkspaceGitRef } from '@deepseek-ai/dsh-workspace-changes/types'
import type {} from './locales.ts'
import type { HistoryTabState } from './store.ts'
import { DiffModeControl } from './DiffModeControl.tsx'
import type { DiffMode } from './DiffModeControl.tsx'
import { absoluteTime, commitRefPills, historyTime } from './history.ts'
import { RefPills } from './RefPills.tsx'
import { useScrollRestore } from './use-scroll-restore.ts'
import css from './HistoryPanel.module.css'

/** One status letter per commit-file kind, as git's own shorthand. */
const LETTER: Readonly<Record<WorkspaceGitCommitFile['kind'], string>> = {
  added: 'A',
  deleted: 'D',
  modified: 'M',
  renamed: 'R',
}

/** How many ref names a commit page names before folding the rest. */
const PAGE_REF_LIMIT = 4

/** The page's props: the history slice, the gestures, and translate. */
export interface CommitPageProps {
  /** The tab's history slice. */
  readonly history: HistoryTabState
  /** Whether the narrow one-column layout is drawing this page. */
  readonly narrow: boolean
  /** Refs grouped by commit hash, for the page's ref pills. */
  readonly tips: ReadonlyMap<string, readonly WorkspaceGitRef[]>
  /** Current epoch ms, for the relative author date. */
  readonly now: number
  /** Leave the narrow drill-down and go back to the list. */
  readonly onBack: () => void
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
  /** Record where the page is scrolled to, for the commit it draws. */
  readonly onScrolled: (hash: string, scrollTop: number) => void
  readonly t: TranslateNS<'sidebarFiles'>
}

/** One changed file: its status letter, path, and line counts. */
function FileRow({ file, active, onSelect, t }: {
  readonly file: WorkspaceGitCommitFile
  readonly active: boolean
  readonly onSelect: (path: string) => void
  readonly t: CommitPageProps['t']
}): ReactNode {
  return (
    <button
      type="button"
      className={clsx(css.fileRow, active && css.fileRowActive)}
      aria-current={active ? 'true' : undefined}
      data-files-history-file={file.path}
      onClick={() => { onSelect(file.path) }}
    >
      <span className={clsx(css.fileLetter, css[`fileLetter_${file.kind}`])}>{LETTER[file.kind]}</span>
      <PathLabel path={file.display} className={css.filePath} />
      <span className={css.fileCounts}>
        {file.binary === true
          ? <span>{t('history.files.binary')}</span>
          : (
            <>
              {file.added > 0 && <span className={css.fileCountsAdded}>{`+${file.added}`}</span>}
              {file.deleted > 0 && <span className={css.fileCountsDeleted}>{`−${file.deleted}`}</span>}
            </>
          )}
      </span>
    </button>
  )
}

/** The comparison box: its filled states and the selected file's hunks. */
function FileComparison({ history, onDiffMode, onRetryDiff, t }: {
  readonly history: HistoryTabState
  readonly onDiffMode: (mode: DiffMode) => void
  readonly onRetryDiff: () => void
  readonly t: CommitPageProps['t']
}): ReactNode {
  const diff = history.diff
  if (history.file === undefined || diff === undefined || diff === 'loading') {
    return (
      <div className={css.diffFill} data-files-history-diff-state="loading">
        <p className={css.note}>{t('history.diff.loading')}</p>
      </div>
    )
  }
  if (diff === 'failed') {
    return (
      <div className={css.diffFill} data-files-history-diff-state="failed">
        <div className={css.noteRow}>
          <span>{t('history.diff.failed')}</span>
          <Button size="sm" data-files-history-diff-retry onClick={onRetryDiff}>{t('retry')}</Button>
        </div>
      </div>
    )
  }
  return (
    <div className={css.diff} data-files-history-diff={diff.path}>
      <div className={css.diffHeader}>
        <span className={css.diffPath} title={diff.path}>{diff.display}</span>
        <DiffModeControl mode={history.diffMode} onMode={onDiffMode} dataAttr="data-files-history-diff-mode" t={t} />
      </div>
      <div className={css.diffBody}>
        {diff.kind === 'binary'
          ? <p className={css.note} data-files-history-diff-state="binary">{t('git.diff.binary')}</p>
          : diff.kind === 'oversized'
            ? <p className={css.note} data-files-history-diff-state="oversized">{t('git.diff.oversized')}</p>
            : diff.hunks.length === 0
              ? <p className={css.note} data-files-history-diff-state="empty">{t('git.diff.empty')}</p>
              : (
                <DiffHunks
                  path={diff.path}
                  hunks={diff.hunks}
                  split={history.diffMode === 'split'}
                  splitOneSided
                  note={diff.before ? undefined : t('git.diff.created')}
                  coarse={diff.coarse}
                  /* v8 ignore next -- the truncated note needs a comparison past the 5000-line cap. */
                  labels={{ coarse: t('diff.coarse'), truncated: count => t('diff.truncated', { count }) }}
                />
              )}
      </div>
    </div>
  )
}

/**
 * Render the selected commit's page, or the state it has before its detail
 * settles.
 * @param props - the history slice, the gestures, and translate.
 * @returns the commit page column.
 */
export function CommitPage(props: CommitPageProps): ReactNode {
  const { history, narrow, tips, now, onBack, onSelectFile, onToggleFiles, onRetryDetail, onRetryDiff, onDiffMode, onScrolled, t } = props
  const [messageOpen, setMessageOpen] = useState(false)
  const selected = history.selected
  const detail = history.detail
  const detailValue = typeof detail === 'object' ? detail : undefined
  const listed = selected === undefined
    ? undefined
    : history.commits.find(commit => commit.hash === selected)
  const commit: WorkspaceGitCommit | undefined = detailValue?.commit ?? listed
  // The page keeps its offset across a container switch, and reports it when
  // the page goes away; an offset for a commit the page no longer draws is
  // dropped by the body's action. The panel remounts this page per selected
  // commit, so the report always names the commit the offset belongs to.
  const { scrollRef: setPage, scrollTopRef } = useScrollRestore(history.pageScrollTop, (top) => {
    if (selected !== undefined) onScrolled(selected, top)
  })

  if (selected === undefined) {
    return (
      <div className={css.page} data-files-history-page data-files-history-page-state="none">
        <p className={css.note}>{t('history.page.none')}</p>
      </div>
    )
  }
  const refs = commit === undefined ? [] : tips.get(commit.hash) ?? []
  const pills = commitRefPills(refs, PAGE_REF_LIMIT)
  // The subject is the message's first paragraph with its line breaks folded
  // to spaces, so a wrapped subject is not a prefix of the stored message; the
  // body starts after the blank line that ends that paragraph.
  const message = detailValue?.message ?? ''
  const bodyAt = message.search(/\r?\n\r?\n/u)
  const messageRest = bodyAt < 0 ? '' : message.slice(bodyAt).trim()
  const files = detailValue?.files ?? []
  const total = detailValue?.total ?? 0
  // The counts are only a commit total when the Host returned every changed
  // file; beside a capped list they would understate the commit, so they stay
  // off the summary and the truncated note states the complete count instead.
  const complete = total === files.length
  const added = complete ? files.reduce((sum, file) => sum + file.added, 0) : 0
  const deleted = complete ? files.reduce((sum, file) => sum + file.deleted, 0) : 0
  return (
    <div
      ref={setPage}
      className={css.page}
      data-files-history-page
      onScroll={(event) => { scrollTopRef.current = event.currentTarget.scrollTop }}
    >
      {narrow && (
        <button type="button" className={css.pageBack} data-files-history-back onClick={onBack}>
          <IconChevronLeftOutlineRegular size={12} />
          <span>{t('history.page.back')}</span>
        </button>
      )}
      {commit !== undefined && (
        <>
          <h2 className={css.pageSubject} data-files-history-page-subject>{commit.subject}</h2>
          <div className={css.pageMeta} data-files-history-page-meta>
            <span className={css.pageHash} data-files-history-page-hash>{commit.short}</span>
            <span>{commit.author}</span>
            <span className={css.pageSep}>·</span>
            <span title={absoluteTime(commit.authoredAt, t)}>{historyTime(commit.authoredAt, now, t)}</span>
            <RefPills pills={pills} className={css.pagePills} />
          </div>
        </>
      )}
      {detailValue === undefined
        ? (
          detail === 'failed'
            ? (
              <div className={css.noteRow} data-files-history-page-state="failed">
                <span>{t('history.page.failed')}</span>
                <Button size="sm" data-files-history-detail-retry onClick={onRetryDetail}>{t('retry')}</Button>
              </div>
            )
            : <p className={css.note} data-files-history-page-state="loading">{t('history.page.loading')}</p>
        )
        : (
          <>
            {messageRest !== '' && (
              <>
                <button
                  type="button"
                  className={css.messageToggle}
                  aria-expanded={messageOpen}
                  data-files-history-message-toggle
                  onClick={() => { setMessageOpen(!messageOpen) }}
                >
                  {messageOpen ? t('history.message.collapse') : t('history.message.expand')}
                  {messageOpen ? <IconChevronDownOutlineRegular size={12} /> : <IconChevronRightOutlineRegular size={12} />}
                </button>
                {messageOpen && <p className={css.message} data-files-history-page-message>{messageRest}</p>}
              </>
            )}
            {files.length === 0
              ? <p className={css.note} data-files-history-files-empty>{t('history.files.empty')}</p>
              : (
                <>
                  {/* The summary states the commit's complete file count; the
                      rows below it are what the Host's cap returned. */}
                  <div className={css.fileSection} data-files-history-file-section>
                    <button
                      type="button"
                      className={css.fileSummary}
                      aria-expanded={history.filesOpen}
                      data-files-history-summary
                      onClick={onToggleFiles}
                    >
                      {history.filesOpen
                        ? <IconChevronDownOutlineRegular size={12} />
                        : <IconChevronRightOutlineRegular size={12} />}
                      <span>{t('history.files.count', { count: total })}</span>
                      {complete && added > 0 && <span className={css.fileSummaryAdded}>{`+${added}`}</span>}
                      {complete && deleted > 0 && <span className={css.fileSummaryDeleted}>{`−${deleted}`}</span>}
                      {!history.filesOpen && history.file !== undefined && (
                        <span className={css.fileSummaryCurrent}>{history.file}</span>
                      )}
                    </button>
                    {history.filesOpen && (
                      <div className={css.fileRows}>
                        {files.map(file => (
                          <FileRow key={file.path} file={file} active={file.path === history.file}
                            onSelect={onSelectFile} t={t} />
                        ))}
                      </div>
                    )}
                    {total > files.length && (
                      <p className={css.fileNote} data-files-history-truncated>
                        {t('history.files.truncated', { shown: files.length, total })}
                      </p>
                    )}
                  </div>
                  <FileComparison history={history} onDiffMode={onDiffMode} onRetryDiff={onRetryDiff} t={t} />
                </>
              )}
          </>
        )}
    </div>
  )
}
