/**
 * Shared history fixtures: the commits, refs, page, commit detail, and file
 * comparison the data, component, and body specs script their reads with.
 */
import type {
  WorkspaceFileDiff, WorkspaceGitCommit, WorkspaceGitCommitDetail, WorkspaceGitHistory, WorkspaceGitRef,
} from '@deepseek-ai/dsh-workspace-changes/types'
import type { HistoryTabState } from '../src/client/store.ts'

/** The session working directory every scripted read echoes. */
export const HISTORY_ROOT = '/work/app'

/** A full commit hash; the store and validators treat hashes opaquely. */
export function hash(letter: string): string {
  return letter.repeat(40)
}

/** Three commits, newest first, with the middle one a merge point. */
export const COMMITS: readonly WorkspaceGitCommit[] = [
  {
    hash: hash('a'), short: 'aaaaaaa', parents: [hash('b')], author: 'jojo',
    authoredAt: '2026-10-19T10:30:00+08:00', subject: 'feat(client): add the history view',
  },
  {
    hash: hash('b'), short: 'bbbbbbb', parents: [hash('c')], author: 'host-git',
    authoredAt: '2026-10-18T09:00:00+08:00', subject: 'Merge branch main',
  },
  {
    hash: hash('c'), short: 'ccccccc', parents: [], author: 'lead',
    authoredAt: '2026-10-17T08:00:00+08:00', subject: 'release: 1.0',
  },
]

/** Two local branches (the attached one first), one remote, one tag. */
export const REFS: readonly WorkspaceGitRef[] = [
  { name: 'dev', refname: 'refs/heads/dev', kind: 'local', hash: hash('a'), head: true },
  { name: 'release', refname: 'refs/heads/release', kind: 'local', hash: hash('c') },
  { name: 'origin/main', refname: 'refs/remotes/origin/main', kind: 'remote', hash: hash('b') },
  { name: 'v1.0.0', refname: 'refs/tags/v1.0.0', kind: 'tag', hash: hash('b') },
]

/** One history page with more commits after it. */
export const PAGE: WorkspaceGitHistory = { commits: COMMITS, hasMore: true }

/** The first commit's page: a two-file commit with a body line. */
export const DETAIL: WorkspaceGitCommitDetail = {
  commit: COMMITS[0]!,
  message: 'feat(client): add the history view\n\nTwo columns: the commit page leads and the navigator trails.',
  total: 2,
  files: [
    { path: 'packages/app/src/a.ts', display: 'packages/app/src/a.ts', kind: 'modified', added: 3, deleted: 1 },
    { path: 'packages/app/b.md', display: 'packages/app/b.md', kind: 'added', added: 2, deleted: 0 },
  ],
}

/** The text comparison variant, so a spread keeps its discriminant. */
type TextDiff = Extract<WorkspaceFileDiff, { kind: 'text' }>

/** The first changed file's comparison. */
export const DIFF: TextDiff = {
  kind: 'text',
  path: 'packages/app/src/a.ts',
  display: 'packages/app/src/a.ts',
  before: true,
  after: true,
  hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-old', '+new'] }],
  coarse: false,
}

/** A tab's history slice with every field defaulted, overridable per case. */
export function historyState(overrides: Partial<HistoryTabState> = {}): HistoryTabState {
  return {
    refs: undefined, refsLoading: false, refsFailure: false, ref: undefined,
    commits: [], listEpoch: 0, hasMore: false, loading: false, failure: false,
    selected: undefined, file: undefined, filesOpen: true,
    detail: undefined, diff: undefined, diffMode: 'unified',
    listScrollTop: 0, pageScrollTop: 0, ratio: 0.58, pageOpen: false,
    ...overrides,
  }
}
