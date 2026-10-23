# Deliverables

English | [中文](deliverables.zh.md)

What a turn hands to the user, owned by the [deliverables package group](../../packages/deliverables/README.md): the files the model declared through the `present` tool, recorded in a log-only Session event, and the files the turn changed, summarized from git working-tree snapshots taken at turn start and turn end plus whole-file captures around each file-tool edit for the paths git does not cover, announced by a log-only event and served by a Host service while the Session lives together with each listed file's turn-start and turn-end comparison. The same service serves the read-only repository history the Files workbench's history view reads. Only clients read them; the Web [deliverables plugin](../../packages/client/ui-deliverables/README.md) renders both at the end of the turn. Tool behavior, snapshot mechanics, and configuration are on the package READMEs for [`tool-present`](../../packages/deliverables/tool-present/README.md) and [`workspace-changes`](../../packages/deliverables/workspace-changes/README.md).

Sources: [`packages/deliverables/tool-present/src/types.ts`](../../packages/deliverables/tool-present/src/types.ts), [`packages/deliverables/workspace-changes/src/types.ts`](../../packages/deliverables/workspace-changes/src/types.ts)

## `PresentedFile` — one declared delivery

```ts type-equiv
/** A declared filesystem file whose current contents remain at its source path. */
interface PresentedFile {
  /** Original absolute path or path relative to the Session working directory. */
  path: string
  /** Optional description supplied by the model. */
  description?: string
}
```

## `WorkspaceChangedFile` — one changed file

```ts type-equiv
/** One file changed during a turn, with line counts from git or from the whole-file captures around its file-tool edits. */
interface WorkspaceChangedFile {
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
```

## `WorkspaceChangesSummary` — one turn's change summary

```ts type-equiv
/** Files changed during one top-level turn, kept on the Host until its Session is disposed. */
interface WorkspaceChangesSummary {
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
```

## `WorkspaceDiffHunk` — one unified-diff hunk

```ts type-equiv
/**
 * One unified-diff hunk. A comparison that asked for the changed hunks keeps
 * three context lines around each change; one that asked for the whole file
 * carries every unchanged line as context. Every line keeps its `+`, `-`, or
 * space prefix.
 */
interface WorkspaceDiffHunk {
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
```

## `WorkspaceFileDiff` — one file's comparison

```ts type-equiv
/** The comparison of one listed file's turn-start and turn-end contents, computed when asked for. */
type WorkspaceFileDiff =
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
```

## `WorkspaceGitEntry` — one changed path

```ts type-equiv
/** One path git reports as changed in the Session working tree. */
interface WorkspaceGitEntry {
  /** Path relative to the Session working directory, always slash-separated. */
  path: string
  /** Sort key and label: the working-directory-relative path, always slash-separated. */
  display: string
  /** What happened to the path. */
  kind: 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked'
  /** Original path of a rename or copy, relative to the Session working directory. */
  from?: string
}
```

## `WorkspaceGitStatus` — the working tree's git state

```ts type-equiv
/** The Session working tree's git state, as the Files workbench's git view lists it. */
interface WorkspaceGitStatus {
  /** `repository` when the working directory is inside a git work tree. */
  kind: 'repository' | 'not-a-repository' | 'unavailable'
  /** Branch name; absent when HEAD is detached. */
  branch?: string
  /** Changed paths in `display` order, capped at the plugin's `maxFiles`. */
  entries: readonly WorkspaceGitEntry[]
  /** Complete changed-path count, including entries omitted by the cap. */
  total: number
}
```

## `WorkspaceGitDiffRequest` — one working-tree comparison request

```ts type-equiv
/** One working-tree path the git view asks to compare with `HEAD`. */
interface WorkspaceGitDiffRequest {
  /** Path relative to the Session working directory. */
  path: string
  /** Original path of a rename or copy, relative to the Session working directory; its `HEAD` content is the old side. */
  from?: string
  /**
   * Cover the whole file: every unchanged line arrives as context, instead of
   * three context lines around each change. Absent or false keeps the changed
   * hunks only.
   */
  complete?: boolean
}
```

## `WorkspaceGitRef` — one selectable ref

```ts type-equiv
/** One ref in the Session working directory's repository, as the history filter offers it. */
interface WorkspaceGitRef {
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
```

## `WorkspaceGitCommit` — one commit

```ts type-equiv
/** One commit as the history list draws it. */
interface WorkspaceGitCommit {
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
```

## `WorkspaceGitHistory` — one history page

```ts type-equiv
/** One page of a repository's history. */
interface WorkspaceGitHistory {
  /** Commits in git's topological order, newest first. */
  commits: readonly WorkspaceGitCommit[]
  /** Whether the ref has commits after this page. */
  hasMore: boolean
}
```

## `WorkspaceGitHistoryRequest` — one page request

```ts type-equiv
/** Where one history page starts and how much it carries. */
interface WorkspaceGitHistoryRequest {
  /** Full ref name to walk, such as `refs/heads/dev`; absent means the repository's `HEAD`. */
  ref?: string
  /** Commits to skip before the page, for paging. */
  skip: number
  /** Commits the page asks for; the Host caps it. */
  limit: number
}
```

## `WorkspaceGitCommitFile` — one changed commit file

```ts type-equiv
/** One file a commit changed, with the line counts git reports. */
interface WorkspaceGitCommitFile {
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
```

## `WorkspaceGitCommitDetail` — one commit's detail

```ts type-equiv
/** One commit's message and changed files, as its page draws them. */
interface WorkspaceGitCommitDetail {
  /** The commit itself. */
  commit: WorkspaceGitCommit
  /** The complete message, subject included, without git's trailing newline. */
  message: string
  /** Files the commit changed under the working directory, capped by the Host. */
  files: readonly WorkspaceGitCommitFile[]
  /** Complete changed-file count under the working directory, including files omitted by the cap. */
  total: number
}
```

## `WorkspaceGitCommitDiffRequest` — one commit-file comparison request

```ts type-equiv
/** One commit file to compare with the commit's first parent. */
interface WorkspaceGitCommitDiffRequest {
  /** Commit id to read, full or abbreviated; the answer describes the commit it resolves to. */
  hash: string
  /** Path relative to the Session working directory. */
  path: string
  /** Original path of a rename, relative to the working directory. */
  from?: string
  /**
   * Cover the whole file: every unchanged line arrives as context, instead of
   * three context lines around each change. Absent or false keeps the changed
   * hunks only.
   */
  complete?: boolean
}
```

## `WorkspaceChanges` — the Host service serving summaries, comparisons, the working tree, and history

`workingTree` and `workingDiff` serve the Files workbench's git view from the Session working directory; `historyRefs`, `history`, `commit`, and `commitDiff` serve its history view from the repository; the earlier methods serve one recorded turn.

```ts type-equiv
/** Serves the summaries and file comparisons the recorder keeps for live Sessions. */
interface WorkspaceChanges {
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
   * @param request - the path to compare, a rename or copy's original path, and whether to cover the whole file.
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
   * @param request - the commit, the path to compare, a rename origin, and whether to cover the whole file.
   * @param signal - the request's cancellation.
   * @returns the comparison, or undefined when a path leaves `cwd` (directly or through a symbolic
   *   link), the commit is unknown, or the path has nothing to compare; an oversized patch answers
   *   `kind: 'oversized'` rather than undefined.
   * @throws when git fails to produce the comparison.
   */
  commitDiff(cwd: string, request: WorkspaceGitCommitDiffRequest, signal: AbortSignal): Promise<WorkspaceFileDiff | undefined>
}
```

## Durable events and the served summary

`tool-present` declaration-merges `deliverables/presented: { turn; callId; files: PresentedFile[] }` into `SessionEventMap`, appended once per successful final `present` result. `workspace-changes` merges `workspace/changes: { turn }`, appended when a top-level turn stops; the summary that event announced is not in the log but is returned by `workspaceChanges.summary(sessionId, seq)` for the event's sequence until the Session is disposed, so a conversation reopened after a Host restart has no changed-files card for its earlier turns. `workspaceChanges.diff(sessionId, seq, index, signal)` compares one listed file on the same terms. A later event for the same turn replaces the earlier one, so a client keeps only the latest. The generated [persistence catalog](../persistence-catalog.md#deliverablespresented--log-only) records both declaration sites. The history methods read the repository directly, append no event, and keep nothing in the log; their refs, pages, commit details, and comparisons are served on demand. Neither event reaches the model.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxworkspacechanges--workspacechanges"></a>

### `ctx.workspaceChanges` — `WorkspaceChanges`

Serves the summaries and file comparisons the recorder keeps for live Sessions.

```ts cordis-catalog
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
 * @param request - the path to compare, a rename or copy's original path, and whether to cover the whole file.
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
 * @param request - the commit, the path to compare, a rename origin, and whether to cover the whole file.
 * @param signal - the request's cancellation.
 * @returns the comparison, or undefined when a path leaves `cwd` (directly or through a symbolic
 *   link), the commit is unknown, or the path has nothing to compare; an oversized patch answers
 *   `kind: 'oversized'` rather than undefined.
 * @throws when git fails to produce the comparison.
 */
commitDiff(cwd: string, request: WorkspaceGitCommitDiffRequest, signal: AbortSignal): Promise<WorkspaceFileDiff | undefined>
```

Types: [SessionId](core.md)

Source: [`packages/deliverables/workspace-changes/src/types.ts`](../../packages/deliverables/workspace-changes/src/types.ts)
<!-- END GENERATED cordis-surface -->
