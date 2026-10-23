# Agent Note: The working-tree git view and the shared comparison renderer

Status: implemented

English | [中文](2026-10-17-files-workbench-git-view.zh.md)

## Problem

The Files workbench could browse and read the workspace, but it could not show what the reader had changed. Seeing a working tree meant leaving the GUI for a terminal, and the only in-product change surface was the turn review — a per-turn summary of what a *turn* touched, not the repository's current state. That review also owned the only numbered, syntax-highlighted comparison renderer, inside its own feature package, so a second surface could not share it without breaking the client's no-cross-feature-import rule, and the crude `DiffBlock` (one column, before/after text pairs) was the only renderer a sibling could reach.

## Decision

The workbench's activity rail offers a second view container: when the session directory is inside a git work tree, `git.status` reports `repository` and the rail draws a branch item beside the files item. The git container replaces the two columns with the change view — the selected path's comparison with `HEAD` on the leading side, the changed paths grouped as Changes and Untracked Files on the trailing side, the same draggable `SplitView` between them, and an icon-only layout toggle above the comparison. Each group folds from its header and starts expanded; each row colors its status letter and file name by kind; the comparison, the list's scroll offset, the layout, and the share are kept per tab.

The Host side is one capability, not a second git stack: `workspaceChanges` gains `workingTree` and `workingDiff`. `workingTree` runs `git rev-parse --is-inside-work-tree` and `git status --porcelain=v1 --branch -z --untracked-files=all` through the runner the turn recorder already bounds; `workingDiff` puts a path's `HEAD` text beside its working copy and hands both to the same `compareText` the turn summaries use. The workbench's host half registers `/api/git.status` and `/api/git.diff` inside the connection fence: both resolve the session and refuse a working directory that differs from the one it resolved, and the diff route refuses a path that escapes it. This made `ui-sidebar-files` a two-faced package (host and client compiler leaves), because a feature that serves routes needs both faces.

The review's numbered comparison rendering moved to `ui-primitives` as `DiffHunks`, and both the review tab's `FileDiff` and the git view draw through it. `DiffHunks` owns line numbering, hunk pairing, highlighting, the rendered-line cap, and the one-column/side-by-side layouts; `FileDiff` keeps only its loading, unavailable, binary, and retry states. The git view passes `splitOneSided`, so a request for the side-by-side layout is honoured even for an addition-only or deletion-only comparison, where the other side is drawn empty; the review tab keeps its own default of one column for those comparisons.

## Alternatives considered

**A separate git plugin package.** The cleanest "one UI feature, one package" reading, but the git view *is* a container of this workbench, and a separate package would have required a rail-slot seam (items plus container rendering) that no second consumer needs yet. **Rejected** for the larger surface.

**Import the review's `FileDiff` from the git view.** Would have reused the renderer without moving it, but the client rules forbid a feature plugin runtime-importing another feature plugin's values. The only legal crossing points are services and slots, and neither fits a renderer that takes comparison data. **Rejected**, which is why the renderer moved down instead.

**A second side-by-side renderer inside the workbench.** Cheap to write and isolated, but it would have been the third diff renderer in the product and would drift from the review's typography, gutters, and highlighting. **Rejected**: one renderer, two layouts.

**Compute the comparison in the browser.** The client has no command execution, and parsing `.git/index` or object files in the browser is not a thing worth owning. **Rejected**.

**Show the turn review's changes as the git view.** The review answers "what did this turn change", not "what is uncommitted now", and it only exists while a session's summary is alive. **Rejected** as the product question.

## Consequences

The rail's container list is data now (`container` in the tab's store), so a third view container extends the array and the store rather than the layout. The comparison engine and the renderer each have exactly one owner, and the git view inherits the review's typography, gutters, highlighting, and rendered-line cap for free. The cost is a two-face package and a Host capability that owns git facts outside the turn recorder, plus two authenticated routes rather than a Typert remote because the comparison payload is view state, not session-transport state. The view is read-only: staging, committing, branch switching, and per-file native opening are not built. Collateral: `ui-open-in-app`'s project reference moved to the workbench's client leaf, and the generated API catalog records the new `DiffHunks` exports.

## Testing

Unit coverage: `workspace-changes` parses porcelain records (branch headers, staged and unstaged arms, renames, unborn and detached heads, ignored records) and compares modified, added, deleted, binary, oversized, and out-of-tree paths against a real repository; `ui-sidebar-files` covers the route contract's validators and coordinates, the handlers' 400/404/409 answers and their session, working-directory, and path checks, the store's git slice (status, selection, diff, layout, share, folded groups), the panel's groups, layout control, comparison states, and per-kind rows, and the body's probe, selection, torn-down reads, toggle, and splitter drag; `ui-primitives` renders both layouts, the one-sided policy, the notes, the rendered-line cap, and the fold labels. Browser coverage: the workbench's own spec opens the git container, switches the layout, folds a group, and records the row kinds against a real repository, and the replay scenarios that draw a comparison keep passing through the shared renderer.
