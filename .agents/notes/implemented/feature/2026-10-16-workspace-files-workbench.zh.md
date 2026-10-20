# Agent Note: 工作区文件工作台与可复用的文档预览

Status: implemented

[English](2026-10-16-workspace-files-workbench.md) | 中文

## Problem

文件 tab 原本只列出工作区目录树，并把每个文件都打开成右侧 Sidebar 里自己的 tab。读第二个文件就要多一个 tab，树被预览挡住，树与文件无法同时看到。文档预览本身又长在 `text` tab 类型的正文里：它通过 `useTabInfo()` 读取地址、导航与生命周期，按 tab id 给渲染器状态分桶，并把 `sidebar.right.tab.document` 各 slot 当作该注册的子 slot 渲染。任何想在自己正文里放预览的宿主，要么重写读取、渲染器选择与工具栏，要么伪造一个 tab 记录。

## Decision

文件 tab 现在是一个**工作台**：标题行保留工作区根路径与重新读取控件；正文画两栏、中间是可拖拽的分隔条，尾随边缘再放一条固定 48px 的活动栏（每个视图容器一个纯图标项（`files`、`git` 与 `history`））——引导侧是内容栏（打开文件的 chips 在读者选中文件的上方），尾随侧是目录树。点击文件行打开一个 chip 并就地显示该文件；chips 用于切换与关闭打开的文件，次键点击会打开 chip 菜单（关闭、关闭其他标签页、关闭所有标签页、关闭左侧标签页、关闭右侧标签页，以及其他插件贡献到 `sidebar.right.tab.files.chip.actions` 的行），chips 最小只缩到 100px，chips 条用滚轮横向滚动且不画滚动条、把隐藏的边缘渐隐，并把在条边界之外打开或成为当前显示的文件滚回可见范围；分隔条每次拖拽结算一个比例，收敛到 20%–80%。树列顶部带 Panel Header（inline 起始侧是 Expand All / Collapse All，末尾侧是 `Project` 标题），工作台的存储把 `open`、`active`、`ratio`、`container` 与树原有的 `root`、`levels`、`expanded`、`scrollTop`、`autoRefresh` 一起按 tab id 分桶，因此重新挂载的工作台会回到读者离开时的样子。

预览现在是由 `ui-sidebar-documentpreview` 注册的可复用 Factory：`sidebar.document.preview`。它的输入是 `{ address, viewKey, navigation, signal, bindRefresh?, refreshShortcut? }`：地址与视图生命周期归宿主所有，读取、渲染器选择、工具栏以及四个文档 slot 归 Factory 所有，这些 slot 由它自己声明为自己的子 slot。`text` tab 正文为自身地址渲染它；文件工作台为某个 chip 显示的文件渲染它。

因此渲染器正文读到的是一个**文档视图**，不再是 tab：`useDocumentView()` 返回 `{ viewKey, navigation, signal }`，渲染器状态按 `viewKey` 分桶，`retainView(viewKey, signal)` 在视图生命周期结束时释放该桶。`useTabInfo`/`retainTab`/`byTab` 已从渲染器契约中移除。Sidebar 自己的落位选项不受此影响：`beside` 仍是给其他调用方的通用落位选项，只是文件树不再使用它。

## Related

本篇部分取代[右侧 Sidebar 停靠基础设施](2026-09-04-right-sidebar-docking-infrastructure.zh.md)（该篇把文件树列为 Sidebar 的随包类型之一）与[文档预览操作](../architecture/2026-09-08-document-preview-operations.zh.md)记录（其渲染器契约现在读取文档视图）。两篇都保持活跃，并就地更新。

## Alternatives considered

**保留预览为 Sidebar tab，并给树一个自己的格。** 这是最初落地的形态：文件行调用 `openResource(address, { beside: 'before' })`，让预览占据树旁边的格。它始终不符合要求的版式——树与文件无法共处一个 tab，分隔条是停靠套件的分栏条而不是工作台的，而且每多读一个文件就多一个 tab 条上的 tab。**已否决**：不是产品的目标形态。

**在文件 tab 内做轻量文本预览。** 更早的尝试自己保存 `OpenFile.content?: string` 并自行绘制文本。它确实自包含，但图片、PDF、Office 文档与表格都会显示不出内容，等于把产品已有的渲染器栈重做一遍。**已否决**：工作台必须复用文档预览。

**为渲染器伪造 tab 形态的上下文。** Factory 本可以为每个文件构造一个 `SidebarRightTabInfo`（用路径冒充 tab id、给一个空操作的 `actions`），从而完全不动任何渲染器。**已否决**：用文件路径冒充 tab id 正是仓库的品牌化 id 规则要防止的假身份，而且日后若有渲染器读取 `tab.actions`，它会无声地出错。

**把工作台放进 Sidebar 而不是文件 tab。** 让某个格呈现为"内容 + 树"的两栏是通用的，但打开文件的 chips 与"文件到预览"的映射是文件专属的，功能会因此渗进 Sidebar 自己的契约。**已否决**：工作台归文件 tab 所有。

## Consequences

渲染器扩展点现在与宿主无关，这正是预览能嵌进任意正文的原因；代价是给第三方渲染器插件带来一次破坏性改名，已记入升级指南。两个宿主显示同一个文件时可以各自保有查看状态，因为视图键由宿主选择（Sidebar 用 tab id，工作台用绝对路径）。工作台的分隔条目前没有键盘操作路径，第二栏（拆分编辑器、并排 diff）也尚未实现。文件 tab 的树与预览各自的自动刷新依旧分开，与预览还是 tab 时一致：工作台的 chips 与比例按 tab 保存，收起再展开的 Sidebar 会保留它们，但整页刷新不会。

## Testing

单元覆盖：工作台存储的 chip 生命周期与比例收敛，`FileTabs` 的两个手势与空态，`SplitView` 的拖拽结算、收敛、取消与几何守卫，以及正文的 chip 与预览接线；文档视图契约经 documentpreview 套件（585 个测试）在两个宿主下验证。浏览器覆盖：`apps/web/tests/document-preview.e2e.ts` 通过工作台打开所有支持的格式，`details-session-lifecycle.e2e.ts` 让工作台经历收起、全屏与终端往返并更新其黄金文件，`excel-opc`/`code-language`/`sidebar-right`/`shortcuts-workspace` 原样重放。
