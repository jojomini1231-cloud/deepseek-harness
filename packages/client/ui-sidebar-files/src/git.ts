/**
 * Working-tree git routes the workbench's git view reads, and the validators
 * its browser half applies to their answers.
 *
 * Both faces of this package share this module: the Host half registers the
 * routes, and the browser half builds the same URLs and checks the payloads it
 * receives. Keeping the paths here means neither face can drift from the other.
 */
import type {
  WorkspaceDiffHunk, WorkspaceFileDiff, WorkspaceGitDiffRequest, WorkspaceGitEntry, WorkspaceGitStatus,
} from '@deepseek-ai/dsh-workspace-changes/types'

/** Authenticated route serving one Session working directory's git status. */
export const GIT_STATUS_PATH = '/api/git.status'

/** Authenticated route serving one changed path's comparison with `HEAD`. */
export const GIT_DIFF_PATH = '/api/git.diff'

/** Browser-relative form of {@link GIT_STATUS_PATH}. */
export const GIT_STATUS_ROUTE = GIT_STATUS_PATH.slice(1)

/** Browser-relative form of {@link GIT_DIFF_PATH}. */
export const GIT_DIFF_ROUTE = GIT_DIFF_PATH.slice(1)

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
  return `${GIT_DIFF_ROUTE}?${query}`
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
