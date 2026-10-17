---
kind: upgrade-guide
description: "ctx.sidebarRight 的 preferNewPane 打开选项改为 beside，可以复用相邻的格而不一定新建分栏。"
---

# 右侧 Sidebar 的打开落位

[English](guide.md) | 中文

## 变更

`ctx.sidebarRight.openResource(address, options)` 与 `openTab(kind, options)` 不再接受 `preferNewPane: boolean`。替代它的是 `beside: 'before' | 'after'`：把新内容落到目标分栏在该侧相邻的格，使目标自身的 tab 保持可见。那里已有格时直接使用；否则在普通两格预算与空间规则允许时从目标分割出新格；两者都不可用时才回退到目标格。`tab.actions.openResource` 与 `tab.actions.openTab` 接受同一选项对象。

因此调用方不仅名字变化，落位行为也变化：`preferNewPane: true` 总是分割目标格，做不到时回退到该格；而 `beside` 会复用已经在所请求一侧的格。过去靠分割腾出位置的内容，现在会把相邻的格原样保留。这些选项只由第三方客户端插件调用：本仓库内的调用方已在本版本一并更新。

## 迁移

1. 在每个 `openResource` / `openTab` 调用中，把 `preferNewPane: true` 换成 `beside: 'after'`（尾随侧）或 `beside: 'before'`（引导侧）。TypeScript 会拒绝已移除的键。
2. 逐个检查这类调用在新复用情形下的表现：当所请求一侧已有停靠格时，tab 落到那里而不覆盖目标格的 tab。必须落到某个确定格时点名 `paneId`；要允许第二份副本时传 `revealIfOpened: false`。
3. 确认调用可以编译，且该手势让触发方的 tab 与新打开的内容并排可见。
