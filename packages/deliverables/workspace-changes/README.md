---
description: "Summarize each top-level turn's changed files from git working-tree snapshots and whole-file captures around file-tool edits, announce them with a workspace/changes Session event, and serve the summary and per-file comparisons while the Session lives, plus the read-only repository history the Files workbench reads; configuration, repository requirement, and coverage rules."
kind: "package-reference"
---

# @deepseek-ai/dsh-workspace-changes

English | [中文](README.zh.md)

## Summary

This plugin summarizes each top-level turn's changed files and serves every listed file's turn-start and turn-end comparison. Turn-start and turn-end working-tree snapshots are diffed; files a file tool edits are copied whole before the edit and again at turn end, covering files git does not. Without a repository or git, only file-tool edits are listed. It also serves read-only repository history for the Files workbench: refs, paged commits, commit detail, and commit-file comparisons. The Session log carries one `workspace/changes` event naming the turn; summaries, comparisons, and history stay on the Host; the Web changed-files card and history view render them.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

The shipped Web bundle mounts this plugin. Mount it in any composition with the `subprocess` capability and a git executable on the Host:

```yaml
- name: '@deepseek-ai/dsh-workspace-changes'
  config:
    maxFiles: 500
```

| Field | Default | Meaning |
|---|---|---|
| `timeoutMs` | `30000` | Milliseconds one git command may run before the turn's record or the history read is abandoned |
| `outputMaxBytes` | `8388608` | Bytes of git output retained per command; a larger diff listing abandons the record and a larger history output fails the read |
| `maxFiles` | `500` | Maximum files carried by one summary or one commit detail; `total` still reports the complete count |
| `maxCommits` | `100` | Maximum commits carried by one history page; a larger page request is clamped to it |
| `maxFileBytes` | `2097152` | Bytes a file may hold to be captured around a file-tool edit or read from a snapshot for its comparison; a larger file gets no comparison, and one captured around a file-tool edit is also listed without counts |
| `diffTimeoutMs` | `100` | Milliseconds a line comparison may run before it degrades to whole-file replacement |

This plugin requires the `subprocess` and `fs` services. Every Session with a working directory and no subagent origin is recorded; subagent Sessions are not. Snapshots are written through a private index into a temporary object directory owned by the Session, with the repository's own object store attached as a read-only alternate; the repository's index, objects, work tree, and refs stay untouched, and the user's earlier uncommitted changes never enter a summary. Session disposal removes the directory. Nested repositories and submodules inside the working directory are recorded as gitlinks, so their internal changes do not appear. A working directory outside any git repository takes no snapshots. Without git — or, on macOS, with only the developer-tools stub at `/usr/bin/git` — no repository is located either, and the plugin logs that once. Either way the summary lists the file-tool edits alone, as described next, with the working directory as the workspace; shell edits are absent.

After a `write`, `edit`, or mutating `str_replace_editor` call resolves its target and obtains its mutation guard, the recorder copies that exact file before the mutation into the Session's temporary directory, once per path per turn, and copies it again at turn end; the copies are named by the SHA-1 of their bytes, so identical content is stored once. This needs no git. Repository discovery and display paths retain the original project; file captures follow the operation's resolved target even after the Session changes directories. Paths the snapshots cover keep their git counts; the copies serve the other paths — files matching an ignore pattern, files outside the repository, and every file-tool edit when there is no snapshot — with counts from a line comparison of the two copies, so repeated edits to one file count once and a shell edit after a file-tool edit is included. A path whose content is unchanged at turn end is not listed. A copy larger than `maxFileBytes` is not stored: the file is listed with `oversized` and no counts, and a path whose both sides are that large is listed too, since unread content is never known to be unchanged. A path whose only difference is a missing final newline compares as unchanged, while git still counts that line. Files under `/tmp` or the platform temporary directory are excluded unless they lie inside the repository. Changes made only through shell commands outside the snapshot coverage are not recorded.

Each file carries a durable `path` — relative to the working directory inside it, absolute elsewhere — and a `display` path used for ordering and labels: the relative path, a `../` path for repository files above the working directory, a `~` path under the home directory, otherwise the absolute path. Files sort by `display` in code-unit order, which lists parent and absolute paths before the working directory's own files. The `workspace/changes` event carries only the turn number; `ctx.workspaceChanges.summary(sessionId, seq)` returns the summary the event with that sequence announced, or undefined once the Session is disposed or when this Host process never recorded it. `ctx.workspaceChanges.diff(sessionId, seq, index, signal)` compares the listed file at that index: hunks with three context lines from the two snapshot trees or the two copies, `binary` for a side git reported as binary or that holds a NUL byte, `oversized` for a side larger than `maxFileBytes`. A line comparison that runs longer than `diffTimeoutMs` degrades to one hunk replacing every line, marked `coarse`. A conversation reopened after a Host restart therefore has no card, and no comparison, for its earlier turns.

`ctx.workspaceChanges.workingTree(cwd, signal)` serves the working directory itself rather than a recorded turn, as the Files workbench's git view needs: one `git -c core.fsmonitor=false status --porcelain=v1 --branch -z --untracked-files=all` scoped to `cwd`, with paths relative to `cwd`, entries capped at `maxFiles` while `total` keeps the complete count, and a rename's or copy's original path in `from`. A directory outside a git work tree reports `not-a-repository`; no git, or a refresh git cannot complete, reports `unavailable`. `ctx.workspaceChanges.workingDiff(cwd, { path, from }, signal)` returns git's own patch for one changed path against `HEAD`, so renames, end-of-line and clean filters, and symbolic links read the way git reads them, and `coarse` is always false. The reads run no repository-configured programs: the status probe disables `core.fsmonitor`, and the comparisons disable external diff drivers and textconv. A path `HEAD` does not hold is compared against `/dev/null`, which covers untracked files and repositories without commits; a link is compared by its text, not by its target. The comparison is `oversized` when either side exceeds `maxFileBytes` or the patch exceeds `outputMaxBytes`, and `binary` when git reports a binary patch. A path or origin outside `cwd` — spelled directly or reached through a directory link — or a git failure returns undefined.

`ctx.workspaceChanges.historyRefs(cwd, signal)` lists the refs the Files workbench's history view offers: local branches, remote branches, and tags in git's order, without a remote's symbolic `HEAD`; an annotated tag is peeled to the commit it names, and the checked-out local branch carries `head: true`. `ctx.workspaceChanges.history(cwd, { ref?, skip, limit }, signal)` walks one page: the ref must name one of those refs, or be absent to walk `HEAD`; `skip` and `limit` are safe integers, a request larger than `maxCommits` is clamped to it, commits arrive in git's topological order newest first, and `hasMore` reports whether commits remain beyond the page. A repository without commits answers an empty page. The topological walk reads the commit graph rather than stopping at the page's last commit, so its cost follows the repository's history instead of the page size; git answers it from the commit-graph file that `git clone`, `git gc`, and `git commit-graph write` produce, and a repository without one pays a full graph walk per page and per refresh.

`ctx.workspaceChanges.commit(cwd, hash, signal)` reads one commit, or returns undefined when `hash` names none: full and short hash, parents, author and author date, subject, the complete message without git's trailing newline, and the files the commit's first-parent diff changes, with a root commit compared against the empty tree and a merge commit against its first parent. Each file carries a working-directory-relative `path` and `display`, a rename's origin in `from` when that origin also lies inside `cwd`, the A/M/D/R kind, line counts, and a `binary` marker; files outside `cwd` are dropped, `total` counts the files inside, and the list is capped at `maxFiles`. `ctx.workspaceChanges.commitDiff(cwd, { hash, path, from? }, signal)` compares one such file with the first parent and returns the same comparison form as `workingDiff`: `before` and `after` come from the `/dev/null` sides, a binary patch is `binary`, a patch beyond the output cap is `oversized`, and a path outside `cwd`, an unknown commit, or a path with nothing to compare is undefined.

These reads are read-only: they run git against the repository without writing refs, objects, the index, or configuration, and they disable external diff drivers, textconv, signature display, and notes, so repository configuration can neither run a program nor change the parsed fields. A ref the repository does not advertise, a page coordinate outside the safe integers, or a git failure throws; the Files workbench reads these methods through its authenticated routes `/api/git.refs`, `/api/git.history`, `/api/git.commit`, and `/api/git.commit-diff`, and [its README](../../client/ui-sidebar-files/README.md) owns route validation and the browser view.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

One `TurnRecorder` per Session serializes its git work. `turn/start` queues the baseline: `rev-parse` locates the repository once per Session and the Session's temporary object directory is created, then `add --all --ignore-errors` into a temporary index seeded from the repository's index and `write-tree` produce the tree id; an unreadable file is skipped and reported through git's exit code 1, which the snapshot accepts. Each turn holds its own state object, so a record still running for an interrupted turn keeps that turn's files when the next turn starts. Every command runs with `GIT_OBJECT_DIRECTORY` pointing at the temporary directory and `GIT_ALTERNATE_OBJECT_DIRECTORIES` at the repository's objects, so committed content is read from the repository and new objects never land there. Every `tools/pre-execute` waits for that queue before a tool runs, so no mutation can precede its baseline; the filesystem's `fs/write-intent` and `fs/edit-intent` waterfalls delegate the guard decision, then queue and await the capture of the resolved target before mutation, and `tool/result` events only mark that the turn has results to record. `agent/turn-stopping` records inside the turn: a second snapshot, `diff-tree -r -M --numstat` between the two trees, `check-ignore` for captured paths inside the work tree, a second copy and line comparison of each uncovered path, the appended event, and the summary kept under the event's sequence beside each listed file's two content sources, a path in a snapshot tree or a copy. A comparison is computed when asked for: `ls-tree -l` locates and sizes a snapshot side and `cat-file blob` reads it under `maxFileBytes`, copies are read from disk, and both sides go through the same line comparison with its timeout. `turn/end` records again only when tool results settled after the last record attempt, which covers aborted, failed, and steered turns without repeating a failed attempt; an empty list after an earlier record supersedes it. The repository's index is only read.

Git runs through the `subprocess` capability with a scrubbed environment, `GIT_CONFIG_COUNT=0` (ambient indexed configuration is excluded because the credential scrub removes its key entries), `GIT_TERMINAL_PROMPT=0`, `GIT_OPTIONAL_LOCKS=0`, the configured timeout, and bounded output. A failing step abandons that turn's record with a warning; the next turn starts afresh. Session disposal and plugin disposal abort queued work, forget the summaries, and remove the temporary directory.

The history reads are independent of the turn recorder: each call runs a fixed set of git commands in the Session working directory, or at the repository root `rev-parse` reports, and parses the NUL fields of `log -z`, `show -s -z`, and `for-each-ref --format` output together with the NUL records of `diff-tree -r -M -z --numstat` and `--raw`. Diffs compare a commit with its first parent, or a root commit with the empty tree, from the repository root so pathspecs stay root-relative; file lists and comparisons map repository paths through `--show-prefix`, and a patch is read by the same parser as `workingDiff`. Every command runs as an argv array with the configured timeout and output cap, and diff pathspecs use `GIT_LITERAL_PATHSPECS=1`; a git failure throws and the Files workbench answers it as a server error, while an unknown commit or path stays undefined.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Web deliverables](../../client/ui-deliverables/README.md) — the changed-files card that reads the served summary and opens its files.
- [Files workbench](../../client/ui-sidebar-files/README.md) — the Web view that reads the served changes, working-tree state, and history.
- [Subprocess capability](../../subprocess/README.md) — the seam git runs through.
- [historical Turn changed-files card decision](../../../.agents/notes/archived/feature/2026-09-11-turn-changed-files-card.md) — snapshot design, coverage rules, the deferred shadow repository, and rejected alternatives.

<a id="model-experience"></a>
## Model Experience

None, as the recorder appends a log-only `workspace/changes` event that only clients read and registers nothing model-facing.

#### KV Cache effect

Nothing here enters a model request, so provider cache reuse is unaffected.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Summaries, snapshot trees, and captured copies live only as long as their Session in this Host process; earlier turns of a conversation reopened after a Host restart have no card and no comparison. This is the decided behavior: a card whose content the Host can no longer open is not shown.
- Two git features still write into the repository's own git directory during a snapshot: `core.splitIndex` writes `sharedindex.*` files, and git-lfs runs its clean filter on changed files and stores their objects under `.git/lfs`.
- git 2.13 or later is required for `rev-parse --absolute-git-dir`; an unsupported repository format or another git failure abandons the turn with a warning rather than being treated as a plain directory.
- The first snapshot of a Session writes every untracked, non-ignored file of the work tree into the Session's temporary directory; a repository without a `.gitignore` that carries large build outputs costs that much temporary space until the Session is disposed.
- Edits the user makes during a turn are attributed to that turn.
- A working directory outside any git repository lists file-tool edits only, so shell edits are missing from its card; a shadow repository under the Harness home is deferred until its exclude rules can replace a missing `.gitignore` reliably.
- Outside snapshot coverage only paths a file tool names are captured: a file only a shell command changes there is absent, and a file both changed before its first file-tool call is compared from that call onward.
- Every file-tool edit copies its whole file once per turn, up to `maxFileBytes`, even for paths the snapshots also cover; the copies go with the Session's temporary directory.
- A comparison serves the listed file's complete text to the client, including ignored files, repository files above the working directory, and files outside the workspace; the summary route serves only paths and counts. A deployment that must keep such content on the Host composes this plugin out.
- A comparison that degrades to whole-file replacement carries every line of both sides, up to twice `maxFileBytes`.
- Windows paths keep native separators in `path`; `display` is always slash-separated.
- git reports a path twice when its index entry is deleted but the file remains untracked; the view lists the path once by its tracked record, so the row and its comparison show the deletion and the untracked file's own content is not listed there.
- History lists committed objects only: uncommitted working-tree changes appear in the git view, not in history, and a commit's files and comparisons are limited to paths inside the Session working directory.
- History detects renames with git's default similarity and does not detect copies: a rewrite below the threshold appears as a deleted and an added path, and a copy appears as an added path.
- A commit comparison sizes neither side beforehand: a patch larger than the smaller of `outputMaxBytes` and three times `maxFileBytes` plus 64 KiB is reported `oversized`.
- The refs list and a walked page are separate reads: a ref deleted or moved between them fails that page read until the view refreshes the refs.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
