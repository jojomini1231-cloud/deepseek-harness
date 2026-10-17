---
kind: upgrade-guide
description: "文档渲染器正文改为读取文档视图（useDocumentView / viewKey / retainView），而不再是所属 Sidebar tab（useTabInfo / retainTab）。"
---

# 文档渲染器的视图契约

[English](guide.md) | 中文

## 变更

注册在 `sidebar.right.tab.document` 下的正文，现在是为一个**文档视图**渲染，而不是为一个 Sidebar tab 渲染：预览已抽成可复用的 `sidebar.document.preview` Factory，`text` tab 正文与文件工作台都渲染它。渲染器作者需要改三个名字：

| 旧 | 新 |
|---|---|
| `props.useTabInfo()`，返回 `{ sidebar, panel, tab }` | `props.useDocumentView()`，返回 `{ viewKey, navigation, signal }` |
| 用 `tab.id` 作为 store 键 | 用 `viewKey` 字符串，每个被展示的文档一个 |
| 渲染器 inject face 里的 `retainTab(tabId, signal)` | `retainView(viewKey, signal)` |

`tab.navigation.params` 变为 `view.navigation.params`，`tab.signal` 变为 `view.signal`。标识一次导航的 revision、`resourceAddress`/`content`/`wrap`/`scrollportRef` 这些 owner prop、只提供元数据的 `useResource`、以及 `ctx.documentPreviews.register` 的元数据与加载字段都不变。渲染器自己的状态改为按 `viewKey` 分桶，因此在两个宿主里看同一个文件会各自保留独立的查看状态。

受影响的是注册文档渲染器正文的第三方插件，也只有它们：本仓库内的渲染器已在同一版本更新。`sidebar.document.preview` 是新增项；想要内嵌预览的宿主调用 `renderFactorySlot('sidebar.document.preview', { address, viewKey, navigation, signal })`，而不是打开一个 Sidebar tab。

## 迁移

1. 在所有 `sidebar.right.tab.document`（以及 `sidebar.right.tab.document.action`）正文里，把 `useTabInfo` prop 换成 `useDocumentView`，并从 `viewKey` 读取文件身份；导航取自 `view.navigation`，取消信号取自 `view.signal`。
2. 把各渲染器 store 的分桶字段与键类型改为视图键（`string`），并把注入的 `retainTab(tabId, signal)` 改名为 `retainView(viewKey, signal)`。
3. 若某个渲染器声明了自己的子 slot 且带 `hookContext: UseSidebarRightTabInfo`，改用 `@deepseek-ai/dsh-client-ui-sidebar-documentpreview/client` 的 `UseDocumentView` 重新声明，并把它的 `inject.hooks` 从 `tabInfo` 改为 `documentView`。
4. 确认正文在两个宿主里都能渲染：从 Files tab 打开文件（工作台内容栏），以及从聊天区的文件链接打开（Sidebar 预览 tab）。
