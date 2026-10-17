---
description: "The right Sidebar's workspace workbench for the dsh web client: the session workspace tree on the trailing side, the open files' chips and the shared document preview on the leading side, and a draggable divider between them."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-sidebar-files

English | [中文](README.zh.md)

## Summary

Browse a Session's workspace tree and read files beside it without leaving the tab: a file row opens a chip in the workbench's content column, which draws that file through the shared document preview. The root and expanded directories refresh automatically from direct-entry watches; manual reload remains available. The tab is reached from the guide and claims no resource address.

## Table of Contents

- [What it registers](#what-it-registers)
- [The workbench](#the-workbench)
- [The tree](#the-tree)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="what-it-registers"></a>
## What it registers

The `workspace.files` command opens or focuses the file page in the focused pane; from the conversation it uses the current Session's active dock pane. A guide gives way to the file page, and repeated opens retain one file page per pane. Desktop defaults to Mod+P. The guide entry displays the effective shortcut; Windows and macOS Web use the [shortcut service’s platform defaults](../shortcuts/README.md); Linux Web leaves this command unbound by default.

- **The type** — `ctx.sidebarRightTabs.register(...)` with kind `files`, id `@deepseek-ai/dsh-client-ui-sidebar-files`, band `builtin`, no patterns, and one guide entry (order 10, its title and description from the `sidebarFiles` namespace, its glyph a yellow folder) that opens the type.
- **The body** — the keyed `sidebar.right.pane.tab` seat under that id: a header row under the strip, then the workbench. The shared [`PathLabel`](../ui-primitives/README.md#component-catalog) displays the root path with subdued directories and a primary final segment. A clipped path retains its trailing characters with a left-edge fade; hovering reveals the full path. The reload control and the Session-scoped `sidebar.right.tab.files.actions` list stay at its right, with the displayed root passed as `absolutePath`; [`ui-open-in-app`](../ui-open-in-app/README.md) contributes the workspace directory opener.
- **The chip title** — the keyed `sidebar.right.pane.tab.title` seat under that id: a shared `FileTypeIcon` folder glyph at 16px before the type's label. The tree's own rows never draw this sheet.

- **The preview** — the file the content column shows is drawn by the reusable `sidebar.document.preview` Factory of [`ui-sidebar-documentpreview`](../ui-sidebar-documentpreview/README.md#the-reusable-preview), which owns reading, renderer selection, and the document toolbar. This package passes the file's address, its absolute path as the view key, a fresh navigation revision, and the tab's abort signal as the view lifetime, so it owns no document format.

Source files under `src/client/`: `definition.tsx` (the type), `store.ts` (what it keeps), `face.ts` (Remote reads and watches), `directory-node.ts` (open directories and their lifetimes), `FilesBody.tsx` (the workbench: its header, its two columns, and the preview Factory call), `tree.tsx` (the tree's rows, ordering, and failure lines), `FileTabs.tsx` (the open files' chips), `SplitView.tsx` (the two columns and their divider), `FilesTitle.tsx` (the chip title), `locales.ts` (what it says), and `index.ts` (the wiring).

<a id="the-workbench"></a>
## The workbench

The body draws two columns with a divider between them: the content column on the leading side and the tree on the trailing one. `SplitView` owns the drag: a pointer press captures the pointer, movement previews the ratio in the component's own state, and the release reports one settled ratio, which `ratioChanged` clamps to 20%–80%. The body memoizes the two columns, so a drag frame re-renders the divider and not the document behind it.

`FilesBody` lays the workbench out as two columns followed by a fixed activity rail at the trailing edge: the rail is a 48px column of icon-only items, one per view container (today the `files` container, its folder glyph marked current, with a tooltip and an accessible name and nothing else drawn), and it never takes part in the divider, so it keeps its width while the columns resize, and its hairline sits on its leading edge. `container` records which container the rail selected, so a second item extends the rail array and the store rather than the layout.

The tree column opens with a panel header: two icon actions at its inline start and the panel title (`tree.title`, "Project") at its end. Expand All (`tree.expand`) opens every directory the tree has listed, with directories that only appear in a level opened by that press following on the next press; Collapse All (`tree.collapse`) collapses every directory back to the root through the face, which ends their listings and watches while keeping the loaded levels so reopening one is instant. The commands ride `sidebar.right.pane.tab.actions` (`tab.actions.bindCommands`); the rail and the header carry `data-files-rail`/`data-files-rail-item` and `data-files-tree-header`/`data-files-tree-action` for the browser specs.

The content column holds the open files' chips above the file the reader chose. A file row calls `fileOpened`, which appends a chip and shows that file; opening the same path again reuses its chip. The chip strip draws no scrollbar: the wheel moves it horizontally (a vertical notch scrolls the row, a line-mode or horizontal delta is honoured, and a strip with nothing hidden leaves the notch to its ancestors), a chip that opens or becomes the shown one past the strip's edge is scrolled back into view without moving any ancestor, and each hidden edge fades the chips out over 24px so the row reads as continuing. Chips shrink only to a 100px floor, so a long row overflows instead of shrinking away. A chip click calls `fileActivated`; its close control (or a middle click) calls `fileClosed`, which shows the next chip, or the previous one when the closed chip was last, and empties the column when the last chip goes. A secondary press opens the chip's menu: Close, Close Other Tabs, Close All Tabs, Close Tabs to the Left, and Close Tabs to the Right call `fileClosed`, `filesClosedExcept`, `filesClosedAll`, `filesClosedBefore`, and `filesClosedAfter`, and each arm that would remove nothing is disabled rather than hidden. After those arms come the rows other plugins contribute to `sidebar.right.tab.files.chip.actions`, where `ui-open-in-app` puts a reveal row that hands the file's folder to the desktop file manager. That empty state names where files come from rather than showing a blank column.

The file is drawn by `renderFactorySlot('sidebar.document.preview', { address, viewKey, navigation, signal })`: the store keeps the absolute path, the address is built by `fileAddressFor` from `@deepseek-ai/dsh-util-workspace-path`, and the view key prefixes the file's absolute path with the tab id, so two workbench tabs over the same file keep their scroll, zoom, wrap, and viewer choice apart, because the Factory buckets its state by the view key. Delivering a file this preview cannot render, a file whose Host path is unknown, and a binary container with no registered renderer are the Factory's own states, unchanged from a Sidebar preview tab.

Everything the workbench keeps lives in the type's own store, bucketed by tab id: `root`, `levels`, `expanded`, `scrollTop`, `autoRefresh`, the open files (`open`), the shown path (`active`), the rail's selected container (`container`), and `ratio`. Because the store outlives the body, switching to another sidebar tab and back remounts the workbench with its chips, its shown file, its divider position, and its tree intact.

<a id="the-tree"></a>
## The tree

The root is the session's working directory, read from `useSessions().byId[sessionId].cwd`. Filesystem roots such as `/` and Windows drive roots are valid tree roots. Every level is keyed by absolute path; a child's path is its parent's joined with the entry name by `/`. A level is listed when it is first expanded, through `remote.workspaceFiles.list(sessionId, absolutePath)` on the `@deepseek-ai/dsh-api-workspace-files` namespace; the adapter keeps the listing's entries and truncation flag and drops its workspace-relative path. Rows are ordered directories first, then by natural, case-insensitive name; dotfiles are shown like any other entry.

| Entry type | Row |
|---|---|
| `directory` | Toggles; reopening lists again and restores still-present expanded descendants. Displayed entries remain cached while collapsed. |
| `file` | Calls `fileOpened` with the entry's absolute path, its `dsh-resource://file/session/<sessionId>/<encoded path relative to the root>` address (built by `fileAddressFor`), and its name: the file joins the content column's chips and becomes the shown one. The row marks the shown file, so the tree answers where the reader is. |
| `other` | Shown greyed and not clickable, so the directory is reported whole. |

A level cut by the endpoint's entry cap ends with a marker; an empty level says so; a level that failed shows one line per code — `workspace-file/not-found`, `outside-workspace`, `not-directory` — and the transport's own message otherwise. Reload refreshes the root and expanded levels in place, retaining displayed entries during reads instead of resetting the whole tree; collapsed levels are fetched again when they next open. A session without a working directory shows a single line instead of a tree.

State lives in the type's own store, bucketed by tab id: `root`, `levels` (loading / ready / failed per absolute path), `expanded`, `autoRefresh`, and `scrollTop`, which the body tracks locally while scrolling and commits once when it unmounts. The tree's levels and its scroll offset outlive the body, so a remounted workbench draws them as they were. The owner's `signal` ends a bucket: on abort the tab is forgotten, and neither a listing that settles afterwards nor the unmount's offset commit writes anything.

Each open `DirectoryNode` owns its target watch for the Tab lifetime; collapse closes that node and its hidden descendants. Expansion changes during ancestor restoration update the store and pending nodes, so restored descendants follow the latest expansion preferences. Automatic refresh defaults to enabled; its separate toggle is hidden while state, labels, styles, and toggle logic remain. Changes received during a directory read or its completion remain pending for another refresh.

<a id="model-experience"></a>
## Model Experience

None, as this package draws a workspace file tree in the browser and registers nothing model-facing.

#### KV Cache effect

None; directory listings travel over the Remote and assemble no model request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>
- **Listing only.** No search, artifact filter, drag-and-drop, or rename in the tree.
- **Expand All is one generation deep.** It opens every directory the tree has already listed; a directory that first appears in a level opened by that press needs a second press.
- **The divider is pointer-only.** It exposes `role="separator"` and its current percentage, but no keyboard route to move it.
- **One content column.** A second pane inside the workbench (split editor, side-by-side diff) is not built.
- **One root.** The tree is rooted at the session's working directory; there is no way to browse above it, and the Host refuses paths outside the workspace root anyway.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

The page refresh shortcut refreshes the focused file tree through its ordinary directory reader. The reload control displays the effective binding on hover and keyboard focus.

</details>
