# Agent Note: Workspace files workbench and the reusable document preview

Status: implemented

English | [中文](2026-10-16-workspace-files-workbench.zh.md)

## Problem

The Files tab listed the workspace tree and opened every file as its own right-Sidebar tab. Reading a second file meant a second tab, the tree disappeared behind the preview, and the tree and the file could not be seen together. The document preview itself lived inside the `text` tab type's body: it read its address, navigation, and lifetime from `useTabInfo()`, bucketed renderer state by tab id, and rendered the `sidebar.right.tab.document` seats as children of that registration. Any host that wanted a preview inside its own body would have had to reimplement reading, renderer selection, and the toolbar, or fake a tab record.

## Decision

The Files tab is a **workbench**: its header row keeps the workspace root's path and reload control; its body draws two columns with a draggable divider and closes with a fixed 48px activity rail at the trailing edge, one icon-only item per view container (the `files`, `git`, and `history` containers) — the content column on the leading side (the open files' chips above the file the reader chose) and the directory tree on the trailing side. A file row opens a chip and shows that file in place; chips switch and close the open files and carry a menu on a secondary press (Close, Close Other Tabs, Close All Tabs, Close Tabs to the Left, Close Tabs to the Right, and whatever other plugins contribute to `sidebar.right.tab.files.chip.actions`), and their strip shrinks chips only to a 100px floor, scrolls on the wheel with no scrollbar drawn, fades its hidden edges, and reveals a chip that opened or became shown past them; the divider settles one ratio per drag, clamped to 20%–80%. The workbench's store keeps `open`, `active`, and `ratio` beside the tree's `root`, `levels`, `expanded`, `scrollTop`, and `autoRefresh`, all bucketed by tab id, so a remounted workbench comes back as the reader left it.

The preview is now a reusable Factory, `sidebar.document.preview`, registered by `ui-sidebar-documentpreview`. Its input is `{ address, viewKey, navigation, signal, bindRefresh?, refreshShortcut? }`: the host owns the address and the view's lifetime, and the Factory owns reading, renderer selection, the toolbar, and the four document seats, which it declares as its own children. The `text` tab body renders it for the tab's address; the Files workbench renders it for the file a chip shows.

A renderer body therefore reads a **document view**, not a tab: `useDocumentView()` returns `{ viewKey, navigation, signal }`, renderer state is bucketed by `viewKey`, and `retainView(viewKey, signal)` releases that bucket when the view's lifetime ends. `useTabInfo`/`retainTab`/`byTab` are gone from the renderer contract. The Sidebar's own placement options are untouched by this: `beside` remains a general open placement for other callers, and the Files tree no longer uses it.

## Related

This note partially supersedes the [right Sidebar docking infrastructure](2026-09-04-right-sidebar-docking-infrastructure.md), which placed the file tree among the Sidebar's shipped types, and the [document preview operations](../architecture/2026-09-08-document-preview-operations.md) record, whose renderer contract now reads a document view. Both stay active and are updated in place.

## Alternatives considered

**Keep the preview a Sidebar tab and give the tree its own pane.** This shipped first: a file row called `openResource(address, { beside: 'before' })`, so the preview took the pane beside the tree. It never matched the requested layout — the tree and the file could not share one tab, the divider was the docking kit's pane divider rather than the workbench's, and every extra file was another tab in the strip. **Rejected** as the product shape.

**A lightweight text preview inside the Files tab.** The earlier attempt kept its own `OpenFile.content?: string` and drew text itself. It would have been self-contained, but it would have shown images, PDFs, office documents, and spreadsheets as nothing, duplicating a renderer stack the product already ships. **Rejected**: the workbench must reuse the document preview.

**Fake a tab-shaped context for the renderers.** The Factory could have constructed a `SidebarRightTabInfo` per file (a path as the tab id, a no-op `actions`), leaving every renderer untouched. **Rejected** because a file path masquerading as a tab id is exactly the false identity the repository's branded-id rule exists to prevent, and a renderer that later read `tab.actions` would silently misbehave.

**Move the workbench into the Sidebar rather than the Files tab.** A pane presentation that splits into content and tree would be generic, but the open-file chips and the file-to-preview mapping are files-specific, so the feature would have leaked into the Sidebar's own contract. **Rejected**: the Files tab owns the workbench.

## Consequences

The renderer extension point is now host-agnostic, which is what allows a preview inside any body; the price is a breaking rename for third-party renderer plugins, recorded in the upgrade guide. Two hosts can now show one file with independent viewer state because the view key is host-chosen (the tab id in the Sidebar, the absolute path in the workbench). The workbench's divider has no keyboard route yet, and a second content column (a split editor, a side-by-side diff) is not built. The Files tab's tree and the preview's own automatic refresh remain separate, as they were when the preview was a tab: the workbench's chips and its ratio are per tab, so a collapsed-and-reopened Sidebar keeps them but a reload of the page does not.

## Testing

Unit coverage: the workbench store's chip lifecycle and ratio clamp, `FileTabs`' two gestures and its empty state, `SplitView`'s drag settle, clamping, cancellation, and geometry guards, and the body's chip-and-preview wiring; the document-view contract through the documentpreview suite (585 tests) in both hosts. Browser coverage: `apps/web/tests/document-preview.e2e.ts` opens every supported format through the workbench, `details-session-lifecycle.e2e.ts` carries the workbench through collapse, fullscreen, and a terminal round trip with its golden updated, and `excel-opc`/`code-language`/`sidebar-right`/`shortcuts-workspace` replay unchanged.
