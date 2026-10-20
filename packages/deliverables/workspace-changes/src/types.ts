/** Per-turn workspace change summaries, the Session event announcing them, and the Host service serving them with their comparisons. */
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** One file changed during a turn, with line counts from git or from the whole-file captures around its file-tool edits. */
export interface WorkspaceChangedFile {
  /** Path relative to the Session working directory, or an absolute Host path outside it. */
  path: string
  /**
   * Sort key and label: the relative path inside the working directory, a
   * `../` path for repository files above it, a `~` path under the home
   * directory, otherwise the absolute path. Always slash-separated.
   */
  display: string
  /** Lines added; zero for a binary or oversized file. */
  added: number
  /** Lines deleted; zero for a binary or oversized file. */
  deleted: number
  /** Present when git reported the file as binary, or when a captured side holds a NUL byte. */
  binary?: true
  /** Present when a captured side exceeded the plugin's `maxFileBytes`; the file is listed without counts or comparison. */
  oversized?: true
}

/** Files changed during one top-level turn, kept on the Host until its Session is disposed. */
export interface WorkspaceChangesSummary {
  /** The turn whose file changes this summary describes. */
  turn: number
  /** The Session working directory `path` values are relative to. */
  cwd: string
  /** Changed files in `display` order, capped at the plugin's `maxFiles`. */
  files: WorkspaceChangedFile[]
  /** Complete changed-file count, including files omitted by the cap. */
  total: number
  /** Lines added over every changed file, including files omitted by the cap. */
  added: number
  /** Lines deleted over every changed file, including files omitted by the cap. */
  deleted: number
  /** Git tree ids of the turn-start and turn-end snapshots; absent when no snapshot was taken. */
  snapshot?: { before: string; after: string }
}

/** One unified-diff hunk with three context lines; every line keeps its `+`, `-`, or space prefix. */
export interface WorkspaceDiffHunk {
  /** First line of the hunk in the turn-start content, 1-based; a side without lines starts at 1 with zero lines. */
  oldStart: number
  /** Lines of the hunk taken from the turn-start content. */
  oldLines: number
  /** First line of the hunk in the turn-end content, 1-based; a side without lines starts at 1 with zero lines. */
  newStart: number
  /** Lines of the hunk taken from the turn-end content. */
  newLines: number
  /** Hunk body in order, each line prefixed with `+`, `-`, or a space. */
  lines: string[]
}

/** The comparison of one listed file's turn-start and turn-end contents, computed when asked for. */
export type WorkspaceFileDiff =
  | {
    kind: 'text'
    /** The listed file's `path`. */
    path: string
    /** The listed file's `display`. */
    display: string
    /** Whether the file existed at turn start. */
    before: boolean
    /** Whether the file existed at turn end. */
    after: boolean
    /** Hunks in file order; empty when both sides hold the same lines. */
    hunks: WorkspaceDiffHunk[]
    /** True when the line comparison exceeded the plugin's `diffTimeoutMs` and every line is shown as replaced. */
    coarse: boolean
  }
  /** A side git reported as binary or that holds a NUL byte; no lines are served. */
  | { kind: 'binary'; path: string; display: string }
  /** A side larger than the plugin's `maxFileBytes`; no lines are served. */
  | { kind: 'oversized'; path: string; display: string }

/** One path git reports as changed in the Session working tree. */
export interface WorkspaceGitEntry {
  /** Path relative to the Session working directory, always slash-separated. */
  path: string
  /** Sort key and label: the working-directory-relative path, always slash-separated. */
  display: string
  /** What happened to the path. */
  kind: 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked'
  /** Original path of a rename or copy, relative to the Session working directory. */
  from?: string
}

/** The Session working tree's git state, as the Files workbench's git view lists it. */
export interface WorkspaceGitStatus {
  /** `repository` when the working directory is inside a git work tree. */
  kind: 'repository' | 'not-a-repository' | 'unavailable'
  /** Branch name; absent when HEAD is detached. */
  branch?: string
  /** Changed paths in `display` order, capped at the plugin's `maxFiles`. */
  entries: readonly WorkspaceGitEntry[]
  /** Complete changed-path count, including entries omitted by the cap. */
  total: number
}

/** One working-tree path the git view asks to compare with `HEAD`. */
export interface WorkspaceGitDiffRequest {
  /** Path relative to the Session working directory. */
  path: string
  /** Original path of a rename or copy, relative to the Session working directory; its `HEAD` content is the old side. */
  from?: string
}

/** One ref in the Session working directory's repository, as the history filter offers it. */
export interface WorkspaceGitRef {
  /** Display name: a local branch such as `dev`, a remote branch such as `origin/dev`, or a tag. */
  name: string
  /**
   * Full ref name, such as `refs/heads/dev`: the identity a history walk names.
   * A branch and a tag may share a display name, and a bare name then resolves
   * to the tag, so walks carry this spelling instead of the short one.
   */
  refname: string
  /** What the ref names. */
  kind: 'local' | 'remote' | 'tag'
  /** Commit hash the ref points at; an annotated tag is peeled to its commit. */
  hash: string
  /** Present and true for the local branch `HEAD` is attached to. */
  head?: true
}

/** One commit as the history list draws it. */
export interface WorkspaceGitCommit {
  /** Full commit hash. */
  hash: string
  /** Abbreviated hash git printed for the commit. */
  short: string
  /** Parent commit hashes in git's order; empty for the root commit. */
  parents: readonly string[]
  /** Author name. */
  author: string
  /** Author date in ISO 8601 with its offset. */
  authoredAt: string
  /** The message's first line. */
  subject: string
}

/** One page of a repository's history. */
export interface WorkspaceGitHistory {
  /** Commits in git's topological order, newest first. */
  commits: readonly WorkspaceGitCommit[]
  /** Whether the ref has commits after this page. */
  hasMore: boolean
}

/** Where one history page starts and how much it carries. */
export interface WorkspaceGitHistoryRequest {
  /** Full ref name to walk, such as `refs/heads/dev`; absent means the repository's `HEAD`. */
  ref?: string
  /** Commits to skip before the page, for paging. */
  skip: number
  /** Commits the page asks for; the Host caps it. */
  limit: number
}

/** One file a commit changed, with the line counts git reports. */
export interface WorkspaceGitCommitFile {
  /** Path relative to the Session working directory, slash-separated. */
  path: string
  /** Sort key and label: the working-directory-relative path. */
  display: string
  /** What happened to the path. */
  kind: 'added' | 'deleted' | 'modified' | 'renamed'
  /** Original path of a rename, relative to the working directory. */
  from?: string
  /** Lines added; zero for a binary file. */
  added: number
  /** Lines deleted; zero for a binary file. */
  deleted: number
  /** Present when git reported the file as binary. */
  binary?: true
}

/** One commit's message and changed files, as its page draws them. */
export interface WorkspaceGitCommitDetail {
  /** The commit itself. */
  commit: WorkspaceGitCommit
  /** The complete message, subject included, without git's trailing newline. */
  message: string
  /** Files the commit changed under the working directory, capped by the Host. */
  files: readonly WorkspaceGitCommitFile[]
  /** Complete changed-file count under the working directory, including files omitted by the cap. */
  total: number
}

/** One commit file to compare with the commit's first parent. */
export interface WorkspaceGitCommitDiffRequest {
  /** Commit id to read, full or abbreviated; the answer describes the commit it resolves to. */
  hash: string
  /** Path relative to the Session working directory. */
  path: string
  /** Original path of a rename, relative to the working directory. */
  from?: string
}

/** Serves the summaries and file comparisons the recorder keeps for live Sessions. */
export interface WorkspaceChanges {
  /**
   * The summary announced by one `workspace/changes` event.
   * @param sessionId - the Session that appended the event.
   * @param seq - the event's sequence number.
   * @returns the summary, or undefined once its Session was disposed or when this Host never recorded it.
   */
  summary(sessionId: SessionId, seq: number): WorkspaceChangesSummary | undefined
  /**
   * Compare one listed file's contents at turn start and turn end.
   * @param sessionId - the Session that appended the event.
   * @param seq - the event's sequence number.
   * @param index - the file's index in the summary's `files`.
   * @param signal - cancels the reads.
   * @returns the comparison, or undefined once its Session was disposed, when this Host never recorded it, or when no file has that index.
   * @throws when a snapshot read fails for a live Session.
   */
  diff(sessionId: SessionId, seq: number, index: number, signal: AbortSignal): Promise<WorkspaceFileDiff | undefined>
  /**
   * Read one working directory's git state.
   * @param cwd - the Session working directory.
   * @param signal - the request's cancellation.
   * @returns the state, or `unavailable` when git cannot answer.
   */
  workingTree(cwd: string, signal: AbortSignal): Promise<WorkspaceGitStatus>
  /**
   * Compare one working-tree path with its `HEAD` content.
   * @param cwd - the Session working directory.
   * @param request - the path to compare and, for a rename or copy, its original path.
   * @param signal - the request's cancellation.
   * @returns the comparison, or undefined when a path leaves `cwd`, the path is gone, or git cannot answer.
   */
  workingDiff(cwd: string, request: WorkspaceGitDiffRequest, signal: AbortSignal): Promise<WorkspaceFileDiff | undefined>
  /**
   * List the refs the history view can walk.
   * @param cwd - the Session working directory.
   * @param signal - the request's cancellation.
   * @returns local branches, remote branches, and tags; annotated tags are peeled to commits.
   * @throws when git cannot answer.
   */
  historyRefs(cwd: string, signal: AbortSignal): Promise<readonly WorkspaceGitRef[]>
  /**
   * Read one page of a ref's history.
   * @param cwd - the Session working directory.
   * @param request - the ref to walk, the commits to skip, and the page size.
   * @param signal - the request's cancellation.
   * @returns the page, or an empty page when the repository has no commits yet.
   * @throws when git cannot answer.
   */
  history(cwd: string, request: WorkspaceGitHistoryRequest, signal: AbortSignal): Promise<WorkspaceGitHistory>
  /**
   * Read one commit's message and changed files.
   * @param cwd - the Session working directory.
   * @param hash - the commit to read.
   * @param signal - the request's cancellation.
   * @returns the commit, or undefined when no commit has that hash.
   * @throws when git cannot answer.
   */
  commit(cwd: string, hash: string, signal: AbortSignal): Promise<WorkspaceGitCommitDetail | undefined>
  /**
   * Compare one commit file with the commit's first parent.
   * @param cwd - the Session working directory.
   * @param request - the commit, the path to compare, and a rename origin.
   * @param signal - the request's cancellation.
   * @returns the comparison, or undefined when a path leaves `cwd` (directly or through a symbolic
   *   link), the commit is unknown, or the path has nothing to compare; an oversized patch answers
   *   `kind: 'oversized'` rather than undefined.
   * @throws when git fails to produce the comparison.
   */
  commitDiff(cwd: string, request: WorkspaceGitCommitDiffRequest, signal: AbortSignal): Promise<WorkspaceFileDiff | undefined>
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * A completed top-level turn's changed files were summarized; the summary itself stays on the
     * Host and is served by `workspaceChanges.summary` for the event's sequence while the Session
     * lives. The latest event for one turn replaces earlier ones.
     */
    'workspace/changes': { turn: number }
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Per-turn changed-file summaries and comparisons of live Sessions. */
    workspaceChanges: WorkspaceChanges
  }
}
