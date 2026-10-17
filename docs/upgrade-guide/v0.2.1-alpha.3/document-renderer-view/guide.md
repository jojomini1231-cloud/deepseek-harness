---
kind: upgrade-guide
description: "Document renderer bodies read a document view (useDocumentView / viewKey / retainView) instead of the enclosing Sidebar tab (useTabInfo / retainTab)."
---

# Document renderer view contract

English | [中文](guide.zh.md)

## Change

A body registered under `sidebar.right.tab.document` is now rendered for a **document view**, not for a Sidebar tab: the preview moved into the reusable `sidebar.document.preview` Factory, which the `text` tab body and the Files workbench both render. Three names changed for renderer authors:

| Before | After |
|---|---|
| `props.useTabInfo()` returning `{ sidebar, panel, tab }` | `props.useDocumentView()` returning `{ viewKey, navigation, signal }` |
| `tab.id` as the store key | the `viewKey` string, one per shown document |
| `retainTab(tabId, signal)` from the renderer's inject face | `retainView(viewKey, signal)` |

`tab.navigation.params` is now `view.navigation.params`, and `tab.signal` is `view.signal`. The revision that identifies a navigation, the `resourceAddress`/`content`/`wrap`/`scrollportRef` owner props, the metadata-only `useResource` hook, and every metadata/loading field of `ctx.documentPreviews.register` are unchanged. A renderer's own state is now bucketed by `viewKey` rather than by tab id, so the same file shown in two hosts keeps two independent viewer states.

Affected are third-party plugins that register a document renderer body, and only they: the repository's own renderers are updated in this same release. `sidebar.document.preview` is new; hosts that want an embedded preview call `renderFactorySlot('sidebar.document.preview', { address, viewKey, navigation, signal })` instead of opening a Sidebar tab.

## Migration

1. In every `sidebar.right.tab.document` (and `sidebar.right.tab.document.action`) body, replace the `useTabInfo` prop with `useDocumentView` and read the file identity from `viewKey`; take navigation from `view.navigation` and cancellation from `view.signal`.
2. Rename each renderer store's bucket field and key type to the view key (`string`), and rename the injected `retainTab(tabId, signal)` to `retainView(viewKey, signal)`.
3. If a renderer declared its own child slot with `hookContext: UseSidebarRightTabInfo`, redeclare it with `UseDocumentView` from `@deepseek-ai/dsh-client-ui-sidebar-documentpreview/client` and update its `inject.hooks` entry from `tabInfo` to `documentView`.
4. Confirm the body renders in both hosts: open the file from the Files tab (the workbench column) and from a conversation file link (the Sidebar preview tab).
