/**
 * Working-tree git routes the workbench's git view reads, the validators its
 * browser half applies to their answers, and the history page size both faces
 * use.
 *
 * Both faces of this package share this module: the Host half registers the
 * routes, and the browser half builds the same URLs and checks the payloads it
 * receives. Keeping the paths here means neither face can drift from the other.
 */
import type {
  WorkspaceDiffHunk, WorkspaceFileDiff, WorkspaceGitCommitDiffRequest, WorkspaceGitCommitDetail,
  WorkspaceGitCommitFile, WorkspaceGitCommit, WorkspaceGitDiffRequest, WorkspaceGitEntry, WorkspaceGitHistory,
  WorkspaceGitHistoryRequest, WorkspaceGitRef, WorkspaceGitStatus,
} from '@deepseek-ai/dsh-workspace-changes/types'

/**
 * Commits one history page carries: the page the browser asks for, and the page
 * the history route serves a request that names none.
 */
export const HISTORY_PAGE_SIZE = 50

/** Authenticated route serving one Session working directory's git status. */
export const GIT_STATUS_PATH = '/api/git.status'

/** Authenticated route serving one changed path's comparison with `HEAD`. */
export const GIT_DIFF_PATH = '/api/git.diff'

/** Authenticated route serving the refs a history view can walk. */
export const GIT_REFS_PATH = '/api/git.refs'

/** Authenticated route serving one page of a ref's history. */
export const GIT_HISTORY_PATH = '/api/git.history'

/** Authenticated route serving one commit's message and changed files. */
export const GIT_COMMIT_PATH = '/api/git.commit'

/** Authenticated route serving one commit file's comparison with its first parent. */
export const GIT_COMMIT_DIFF_PATH = '/api/git.commit-diff'

/** Browser-relative form of {@link GIT_STATUS_PATH}. */
export const GIT_STATUS_ROUTE = GIT_STATUS_PATH.slice(1)

/** Browser-relative form of {@link GIT_DIFF_PATH}. */
export const GIT_DIFF_ROUTE = GIT_DIFF_PATH.slice(1)

/** Browser-relative form of {@link GIT_REFS_PATH}. */
export const GIT_REFS_ROUTE = GIT_REFS_PATH.slice(1)

/** Browser-relative form of {@link GIT_HISTORY_PATH}. */
export const GIT_HISTORY_ROUTE = GIT_HISTORY_PATH.slice(1)

/** Browser-relative form of {@link GIT_COMMIT_PATH}. */
export const GIT_COMMIT_ROUTE = GIT_COMMIT_PATH.slice(1)

/** Browser-relative form of {@link GIT_COMMIT_DIFF_PATH}. */
export const GIT_COMMIT_DIFF_ROUTE = GIT_COMMIT_DIFF_PATH.slice(1)

/**
 * Build the authenticated status coordinates for one Session.
 * @param sessionId - the viewed Session.
 * @param cwd - the working directory the Session resolved, echoed for the Host's check.
 * @returns the route URL.
 */
export function gitStatusUrl(sessionId: string, cwd: string): string {
  return `${GIT_STATUS_ROUTE}?${new URLSearchParams({ sessionId, cwd })}`
}

/**
 * Build the authenticated comparison coordinates for one changed path.
 * @param sessionId - the viewed Session.
 * @param cwd - the working directory the Session resolved, echoed for the Host's check.
 * @param request - the changed path and, for a rename or copy, its original path.
 * @returns the route URL.
 */
export function gitDiffUrl(sessionId: string, cwd: string, request: WorkspaceGitDiffRequest): string {
  const query = new URLSearchParams({ sessionId, cwd, path: request.path })
  if (request.from !== undefined) query.set('from', request.from)
  if (request.complete === true) query.set('complete', '1')
  return `${GIT_DIFF_ROUTE}?${query}`
}

/**
 * Build the authenticated coordinates of the refs a history view can walk.
 * @param sessionId - the viewed Session.
 * @param cwd - the working directory the Session resolved, echoed for the Host's check.
 * @returns the route URL.
 */
export function gitRefsUrl(sessionId: string, cwd: string): string {
  return `${GIT_REFS_ROUTE}?${new URLSearchParams({ sessionId, cwd })}`
}

/**
 * Build the authenticated coordinates of one history page.
 * @param sessionId - the viewed Session.
 * @param cwd - the working directory the Session resolved, echoed for the Host's check.
 * @param request - the ref to walk, the commits to skip, and the page size.
 * @returns the route URL.
 */
export function gitHistoryUrl(sessionId: string, cwd: string, request: WorkspaceGitHistoryRequest): string {
  const query = new URLSearchParams({ sessionId, cwd, skip: String(request.skip), limit: String(request.limit) })
  if (request.ref !== undefined) query.set('ref', request.ref)
  return `${GIT_HISTORY_ROUTE}?${query}`
}

/**
 * Build the authenticated coordinates of one commit's detail.
 * @param sessionId - the viewed Session.
 * @param cwd - the working directory the Session resolved, echoed for the Host's check.
 * @param hash - the commit to read.
 * @returns the route URL.
 */
export function gitCommitUrl(sessionId: string, cwd: string, hash: string): string {
  return `${GIT_COMMIT_ROUTE}?${new URLSearchParams({ sessionId, cwd, hash })}`
}

/**
 * Build the authenticated coordinates of one commit file's comparison.
 * @param sessionId - the viewed Session.
 * @param cwd - the working directory the Session resolved, echoed for the Host's check.
 * @param request - the commit, the path to compare, and a rename origin.
 * @returns the route URL.
 */
export function gitCommitDiffUrl(sessionId: string, cwd: string, request: WorkspaceGitCommitDiffRequest): string {
  const query = new URLSearchParams({ sessionId, cwd, hash: request.hash, path: request.path })
  if (request.from !== undefined) query.set('from', request.from)
  if (request.complete === true) query.set('complete', '1')
  return `${GIT_COMMIT_DIFF_ROUTE}?${query}`
}

/** What a git entry may report. */
const ENTRY_KINDS: ReadonlySet<string> = new Set(['modified', 'added', 'deleted', 'renamed', 'untracked'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isGitEntry(value: unknown): value is WorkspaceGitEntry {
  return isRecord(value)
    && typeof value.path === 'string' && value.path !== '' && !value.path.startsWith('/')
    && typeof value.display === 'string'
    && typeof value.kind === 'string' && ENTRY_KINDS.has(value.kind)
    && (value.from === undefined
      || (typeof value.from === 'string' && value.from !== '' && !value.from.startsWith('/')))
}

/**
 * Whether a decoded JSON value is a working-tree status the view can draw.
 * @param value - decoded JSON.
 * @returns whether it is one of the three states with well-formed entries.
 */
export function isGitStatus(value: unknown): value is WorkspaceGitStatus {
  if (!isRecord(value)) return false
  if (value.kind === 'not-a-repository' || value.kind === 'unavailable') {
    return value.total === 0 && Array.isArray(value.entries) && value.entries.length === 0
  }
  return value.kind === 'repository'
    && (value.branch === undefined || typeof value.branch === 'string')
    && Number.isSafeInteger(value.total) && (value.total as number) >= 0
    && Array.isArray(value.entries) && value.entries.length <= (value.total as number)
    && value.entries.every(isGitEntry)
}

function isHunk(value: unknown): value is WorkspaceDiffHunk {
  if (!isRecord(value)) return false
  const { oldStart, oldLines, newStart, newLines, lines } = value
  return [oldStart, oldLines, newStart, newLines].every(field =>
    typeof field === 'number' && Number.isSafeInteger(field) && field >= 0)
    && Array.isArray(lines) && lines.every(line => typeof line === 'string' && /^[+ -]/.test(line))
}

/**
 * Whether two working-tree states describe the same tree.
 * @param left - the state the panel shows, if any.
 * @param right - the state a read answered.
 * @returns whether every field the view draws is identical.
 */
export function sameGitStatus(left: WorkspaceGitStatus | undefined, right: WorkspaceGitStatus): boolean {
  if (left === undefined || left.kind !== right.kind || left.branch !== right.branch) return false
  // The summary draws the complete count, which moves on its own when the entry
  // cap holds the list still.
  if (left.total !== right.total) return false
  if (left.entries.length !== right.entries.length) return false
  return left.entries.every((entry, at) => {
    const other = right.entries[at]
    return other !== undefined && entry.path === other.path && entry.display === other.display
      && entry.kind === other.kind && entry.from === other.from
  })
}

/**
 * Whether a decoded JSON value is one file comparison the view can draw.
 * @param value - decoded JSON.
 * @returns whether it is a text comparison with hunks, or a binary/oversized marker.
 */
export function isFileDiff(value: unknown): value is WorkspaceFileDiff {
  if (!isRecord(value) || typeof value.path !== 'string' || value.path === ''
    || typeof value.display !== 'string' || value.display === '') return false
  if (value.kind === 'binary' || value.kind === 'oversized') return true
  return value.kind === 'text'
    && typeof value.before === 'boolean' && typeof value.after === 'boolean'
    && typeof value.coarse === 'boolean'
    && Array.isArray(value.hunks) && value.hunks.every(isHunk)
}

/** A full git object id, whether the repository uses SHA-1 or SHA-256. */
const HASH = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/

/** What a commit file may report. */
const COMMIT_FILE_KINDS: ReadonlySet<string> = new Set(['added', 'deleted', 'modified', 'renamed'])

/** What a ref may report. */
const REF_KINDS: ReadonlySet<string> = new Set(['local', 'remote', 'tag'])

/** A full ref name: one of the three namespaces a history walk names. */
const REF = /^refs\/(?:heads|remotes|tags)\/\S+$/u

/**
 * Whether a decoded JSON value is one ref the history filter can show.
 * @param value - decoded JSON.
 * @returns whether its name, kind, and commit hash are well formed.
 */
function isGitRef(value: unknown): value is WorkspaceGitRef {
  return isRecord(value)
    && typeof value.name === 'string' && value.name !== ''
    && typeof value.refname === 'string' && REF.test(value.refname)
    && typeof value.kind === 'string' && REF_KINDS.has(value.kind)
    && typeof value.hash === 'string' && HASH.test(value.hash)
    && (value.head === undefined || value.head === true)
}

/**
 * Whether a decoded JSON value is the refs list.
 * @param value - decoded JSON.
 * @returns whether every member is a well-formed ref.
 */
export function isGitRefs(value: unknown): value is readonly WorkspaceGitRef[] {
  return Array.isArray(value) && value.every(isGitRef)
}

/**
 * Whether a decoded JSON value is one commit the history list can draw.
 * @param value - decoded JSON.
 * @returns whether its hashes, author date, and subject are well formed.
 */
function isGitCommit(value: unknown): value is WorkspaceGitCommit {
  return isRecord(value)
    && typeof value.hash === 'string' && HASH.test(value.hash)
    && typeof value.short === 'string' && value.short !== ''
    && Array.isArray(value.parents) && value.parents.every(parent => typeof parent === 'string' && HASH.test(parent))
    && typeof value.author === 'string'
    && typeof value.authoredAt === 'string' && !Number.isNaN(Date.parse(value.authoredAt))
    && typeof value.subject === 'string'
}

/**
 * Whether a decoded JSON value is one history page.
 * @param value - decoded JSON.
 * @returns whether every commit is well formed.
 */
export function isGitHistory(value: unknown): value is WorkspaceGitHistory {
  return isRecord(value)
    && Array.isArray(value.commits) && value.commits.every(isGitCommit)
    && typeof value.hasMore === 'boolean'
}

/**
 * Whether a decoded JSON value is one commit file the page can draw.
 * @param value - decoded JSON.
 * @returns whether its path, kind, and counts are well formed.
 */
function isGitCommitFile(value: unknown): value is WorkspaceGitCommitFile {
  return isRecord(value)
    && typeof value.path === 'string' && value.path !== '' && !value.path.startsWith('/')
    && typeof value.display === 'string'
    && typeof value.kind === 'string' && COMMIT_FILE_KINDS.has(value.kind)
    && (value.from === undefined || (typeof value.from === 'string' && value.from !== '' && !value.from.startsWith('/')))
    && Number.isSafeInteger(value.added) && (value.added as number) >= 0
    && Number.isSafeInteger(value.deleted) && (value.deleted as number) >= 0
    && (value.binary === undefined || value.binary === true)
}

/**
 * Whether a decoded JSON value is one commit's detail the page can draw.
 * @param value - decoded JSON.
 * @returns whether its commit, message, and file list are well formed.
 */
export function isGitCommitDetail(value: unknown): value is WorkspaceGitCommitDetail {
  return isRecord(value)
    && isGitCommit(value.commit)
    && typeof value.message === 'string'
    && Number.isSafeInteger(value.total) && (value.total as number) >= 0
    && Array.isArray(value.files) && value.files.length <= (value.total as number)
    && value.files.every(isGitCommitFile)
}
