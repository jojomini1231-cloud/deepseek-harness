# 产出物

[English](deliverables.md) | 中文

记录一轮交给用户的东西，由 [deliverables 包组](../../packages/deliverables/README.zh.md)拥有：模型通过 `present` 工具声明的文件，记在一个只写日志的 Session 事件里；这一轮改动的文件，由轮开始和轮结束时的 git 工作树快照对比得出，git 覆盖不到的路径则由文件工具每次编辑前后的整文件捕获得出，用一个只写日志的事件宣告，并在 Session 存活期间由 Host 服务连同每个所列文件在轮开始与轮结束时的对比一起提供。它们只由客户端读取，Web [产出物插件](../../packages/client/ui-deliverables/README.zh.md)在轮末渲染两者。工具行为、快照机制和配置见 [`tool-present`](../../packages/deliverables/tool-present/README.zh.md) 与 [`workspace-changes`](../../packages/deliverables/workspace-changes/README.zh.md) 的包 README。

源码：[`packages/deliverables/tool-present/src/types.ts`](../../packages/deliverables/tool-present/src/types.ts)、[`packages/deliverables/workspace-changes/src/types.ts`](../../packages/deliverables/workspace-changes/src/types.ts)

## `PresentedFile`：一条声明的交付

```ts type-equiv
/** A declared filesystem file whose current contents remain at its source path. */
interface PresentedFile {
  /** Original absolute path or path relative to the Session working directory. */
  path: string
  /** Optional description supplied by the model. */
  description?: string
}
```

## `WorkspaceChangedFile`：一个改动的文件

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

## `WorkspaceChangesSummary`：一轮的改动摘要

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

## `WorkspaceDiffHunk`：一个 unified diff hunk

```ts type-equiv
/** One unified-diff hunk with three context lines; every line keeps its `+`, `-`, or space prefix. */
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

## `WorkspaceFileDiff`：一个文件的对比

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

## `WorkspaceGitEntry`：一个改动的路径

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

## `WorkspaceGitStatus`：工作区的 git 状态

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

## `WorkspaceGitDiffRequest`：一次工作区对比请求

```ts type-equiv
/** One working-tree path the git view asks to compare with `HEAD`. */
interface WorkspaceGitDiffRequest {
  /** Path relative to the Session working directory. */
  path: string
  /** Original path of a rename or copy, relative to the Session working directory; its `HEAD` content is the old side. */
  from?: string
}
```

## `WorkspaceChanges`：提供摘要、对比与工作区状态的 Host 服务

`workingTree` 与 `workingDiff` 为 Files 工作台的 git 视图读取 Session 的工作目录；先前的方法服务一个已记录的轮次。

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
   * @param request - the path to compare and, for a rename or copy, its original path.
   * @param signal - the request's cancellation.
   * @returns the comparison, or undefined when a path leaves `cwd`, the path is gone, or git cannot answer.
   */
  workingDiff(cwd: string, request: WorkspaceGitDiffRequest, signal: AbortSignal): Promise<WorkspaceFileDiff | undefined>
}
```

## 持久事件与提供的摘要

`tool-present` 通过声明合并把 `deliverables/presented: { turn; callId; files: PresentedFile[] }` 加入 `SessionEventMap`，每次 `present` 的最终结果成功时追加一条。`workspace-changes` 合并 `workspace/changes: { turn }`，在顶层轮停止时追加；该事件宣告的摘要不在日志里，而是由 `workspaceChanges.summary(sessionId, seq)` 按事件序号返回，直到 Session 释放，因此 Host 重启后重新打开的对话，先前轮次没有改动文件卡片。`workspaceChanges.diff(sessionId, seq, index, signal)` 按同样的条件对比一个所列文件。同一轮后来的事件替代先前的，客户端只保留最新一条。生成的[持久化目录](../persistence-catalog.zh.md#deliverablespresented--log-only)记录了两处声明位置。两个事件都不会进入模型请求。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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
 * @param request - the path to compare and, for a rename or copy, its original path.
 * @param signal - the request's cancellation.
 * @returns the comparison, or undefined when a path leaves `cwd`, the path is gone, or git cannot answer.
 */
workingDiff(cwd: string, request: WorkspaceGitDiffRequest, signal: AbortSignal): Promise<WorkspaceFileDiff | undefined>
```

Types: [SessionId](core.zh.md)

Source: [`packages/deliverables/workspace-changes/src/types.ts`](../../packages/deliverables/workspace-changes/src/types.ts)
<!-- END GENERATED cordis-surface -->
