---
description: "dsh Web 客户端右侧 Sidebar 的工作区工作台：尾随侧是会话工作区目录树，引导侧是打开文件的 chips 与共享文档预览，中间是可拖拽的分隔条。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-sidebar-files

[English](README.md) | 中文

## 概述

浏览 Session 的工作区目录树，并在同一 tab 内就地读取文件：点击文件行会在工作台内容栏打开一个 chip，由共享文档预览绘制该文件。根目录与已展开目录通过直接子项监听自动刷新，手动重新读取仍可用。该 tab 从引导页进入，不认领资源地址。

## 目录

- [注册了什么](#what-it-registers)
- [工作台](#the-workbench)
- [树](#the-tree)
- [模型体验](#model-experience)
- [已知限制与暂缓事项](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="what-it-registers"></a>
## 注册了什么

命令 `workspace.files` 在焦点分栏内打开或聚焦文件页；从聊天区触发时使用当前会话的活动停靠分栏。文件页替换开始页，同一分栏内重复打开仍保留一个文件页。桌面默认键为 Mod+P。开始页入口显示有效快捷键；Windows 和 macOS Web 使用[快捷键服务的平台默认值](../shortcuts/README.zh.md)；Linux Web 默认不绑定此命令。

- **类型**：`ctx.sidebarRightTabs.register(...)`，kind 为 `files`，id 为 `@deepseek-ai/dsh-client-ui-sidebar-files`，档位 `builtin`，没有 patterns，另有一个打开该类型的引导页入口（order 10，标题与描述取自 `sidebarFiles` 命名空间，图标为黄色文件夹）。
- **正文**：以该 id 为键的 `sidebar.right.pane.tab` slot：strip 下的一行标题行，然后是工作台。共享的 [`PathLabel`](../ui-primitives/README.zh.md#component-catalog) 显示根路径，目录使用弱化颜色，最后一段使用主色。路径过长时保留尾部字符并在左侧渐隐；悬停显示完整路径。重新读取控件和 Session 作用域的 `sidebar.right.tab.files.actions` 列表位于右端，并通过 `absolutePath` 传入当前显示的根目录；[`ui-open-in-app`](../ui-open-in-app/README.zh.md) 在此提供工作区目录打开按钮。
- **标签页标题**：以该 id 为键的 `sidebar.right.pane.tab.title` slot：类型标签前的一枚 16px 共享 `FileTypeIcon` 文件夹图标。树本身的行不画这枚图标。

- **预览**：内容栏显示的文件由 [`ui-sidebar-documentpreview`](../ui-sidebar-documentpreview/README.zh.md#the-reusable-preview) 的可复用 `sidebar.document.preview` Factory 绘制，读取、渲染器选择与文档工具栏都归它所有。本包传入文件地址、作为视图键的绝对路径、新的导航修订号，以及该 tab 的中止 signal 作为视图生命周期，因此本包不持有任何文档格式。

`src/client/` 下的源文件：`definition.tsx`（类型是什么）、`store.ts`（它保存什么）、`face.ts`（Remote 读取与监听）、`directory-node.ts`（打开的目录及其生命周期）、`FilesBody.tsx`（工作台：标题行、两栏与预览 Factory 调用）、`tree.tsx`（树的行、排序与失败行）、`FileTabs.tsx`（打开文件的 chips）、`SplitView.tsx`（两栏与分隔条）、`FilesTitle.tsx`（标签页标题）、`locales.ts`（它说什么）、`index.ts`（接线）。

<a id="the-workbench"></a>
## 工作台

正文画两栏，中间是分隔条：引导侧是内容栏，尾随侧是树。拖拽由 `SplitView` 负责：按下时捕获指针，移动时只在组件自身状态里预览比例，松开时上报一个已结算的比例，由 `ratioChanged` 收敛到 20%–80%。正文对两栏做了 memo，因此拖拽帧只重绘分隔条，不重绘其后的文档。

内容栏在读者选中的文件上方放打开文件的 chips。文件行调用 `fileOpened`，追加一个 chip 并显示该文件；再次打开同一路径会复用它已有的 chip。chips 条不画滚动条：滚轮让它横向滚动（纵向滚轮滚动该行，行模式或横向 delta 同样生效，没有可滚内容的条会把该次滚动留给祖先），在条边界之外打开或成为当前显示的文件会被滚回可见范围内且不移动任何祖先的滚动位置，每个被隐藏的边缘会把 chips 渐隐 24px，让该行读起来是继续而非被截断。chips 最小只缩到 100px，因此长行会溢出而不是一路缩小。点击 chip 调用 `fileActivated`；chip 的关闭控件（或中键点击）调用 `fileClosed`，它会显示下一个 chip，被关闭的是最后一个时显示上一个，关闭最后一个 chip 后内容栏清空。次键点击打开该 chip 的菜单：关闭、关闭其他标签页、关闭所有标签页、关闭左侧标签页与关闭右侧标签页分别调用 `fileClosed`、`filesClosedExcept`、`filesClosedAll`、`filesClosedBefore` 与 `filesClosedAfter`，而不会删掉任何 chip 的那一项是禁用而不是隐藏。`打开所在文件夹` 调用树 face 的 `reveal`，展开该文件的各级祖先目录并标出其行，让读者看到文件来自哪里。清空状态说明文件从哪里来，而不是留一片空白。

文件通过 `renderFactorySlot('sidebar.document.preview', { address, viewKey: absolutePath, navigation, signal })` 绘制：存储里保存绝对路径，地址由 `@deepseek-ai/dsh-util-workspace-path` 的 `fileAddressFor` 生成。因此两个工作台看同一个文件时，滚动、缩放、换行与查看器选择各自独立，因为 Factory 按视图键分桶。无法预览的文件、Host 路径未知的文件、以及没有注册渲染器的二进制容器，都是 Factory 自己的状态，与在侧栏预览 tab 中完全一致。

工作台保存的一切都在类型自己的存储里，按 tab id 分桶：`root`、`levels`、`expanded`、`scrollTop`、`autoRefresh`、打开的文件（`open`）、当前显示的路径（`active`）、某次 reveal 要求显示的行（`revealed`，其 token 每次请求都会前进）与 `ratio`。存储比 body 活得久，切到其他侧栏 tab 再切回来时，chips、当前文件、分隔条位置与树都保持原样。

<a id="the-tree"></a>
## 树

根是会话的工作目录，读自 `useSessions().byId[sessionId].cwd`。`/` 和 Windows 盘根等文件系统根路径均可作为树的根。每一层以绝对路径为键；子路径是父路径以 `/` 拼上条目名。一层在首次展开时经 `@deepseek-ai/dsh-api-workspace-files` 命名空间的 `remote.workspaceFiles.list(sessionId, absolutePath)` 列出；适配器保留列表的条目与截断标志，丢弃其工作区相对路径。行序为目录优先，其后按自然序、不分大小写的名称排列；dotfiles 与其他条目一样显示。

| 条目类型 | 行 |
|---|---|
| `directory` | 切换展开与折叠；再次打开时重新列举，并恢复仍存在的已展开后代。折叠期间保留已显示条目的缓存。 |
| `file` | 调用 `fileOpened`，传入条目的绝对路径、由 `fileAddressFor` 生成的 `dsh-resource://file/session/<sessionId>/<encoded path relative to the root>` 地址与文件名：该文件加入内容栏的 chips 并成为当前显示的文件。行上会标出当前显示的文件，而 chip 的 `打开所在文件夹` 落到的那一行取触感填充，树因此既回答了读者所在的位置，也回答了 reveal 到了哪里。 |
| `other` | 灰显且不可点击，从而完整呈现目录内容。 |

被端点条目上限截断的层以一条标记收尾；空层如实说明；失败的层按错误码各显示一行（`workspace-file/not-found`、`outside-workspace`、`not-directory`），其他情况显示传输层自己的消息。重新读取就地刷新根与展开中的层，读取期间保留显示条目，不重置整棵树；折叠的层在下次打开时重新拉取。没有工作目录的会话只显示一行说明，而不是树。

状态保存在类型自己的存储里，按 tab id 分桶：`root`、`levels`（每个绝对路径的 loading / ready / failed）、`expanded`、`autoRefresh` 与 `scrollTop`——滚动期间偏移由正文自己记录，卸载时一次性写入。树的层与滚动位置比 body 活得久，工作台重新挂载时按原样绘制。owner 的 `signal` 终结一个桶：中止时忘掉该 tab，其后才结算的列表与卸载时的偏移提交都什么也不写。

每个打开的 `DirectoryNode` 在 Tab 生命周期内持有自己的目标监听；折叠关闭该节点及其不可见后代。祖先恢复期间的展开状态变化会更新存储和待恢复节点，后代恢复时遵循最新展开偏好。自动刷新默认开启；独立开关暂时隐藏，状态、文案、样式与切换逻辑保留。目录读取期间或收尾时收到的变化仍会留待下一次刷新。

<a id="model-experience"></a>
## 模型体验

无，因为本包在浏览器里绘制工作区文件树，不注册任何面向模型的内容。

#### KV Cache 影响

无；目录列表经 Remote 传输，不会组装模型请求。

## 已知限制与暂缓事项

<a id="known-limitations-and-deferred-work"></a>
- **只有列目录。**没有搜索、产物过滤、拖拽、重命名或右键菜单；树只标出内容栏当前显示的文件。
- **分隔条只支持指针。**它暴露 `role="separator"` 与当前百分比，但没有键盘调节路径。
- **只有一个内容栏。**工作台内的第二栏（拆分编辑器、并排 diff）尚未实现。
- **只有一个根。**树以会话工作目录为根；没有办法浏览到它之上，而 Host 本来也拒绝工作区根之外的路径。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

页面刷新快捷键通过常规目录读取器刷新聚焦的文件树。重新读取控件在悬停和键盘聚焦时显示有效绑定。

</details>
