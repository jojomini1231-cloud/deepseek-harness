---
description: "Host 与 Client 工作区控制：修改工作区导航并跟随其完整投影。"
kind: "package-reference"
---
# Workspace Controller

[English](README.md) | 中文

## 概述

`@deepseek-ai/dsh-api-workspace-controller` 拥有 Host 的 `ctx.workspaceController` 服务和生成的 Client `ctx.remote.workspace` namespace。它的 Remote 方法负责创建、重命名、移除和重排 Workspace，在 Workspace 内重排 Session，归档与取消归档 Session，以及跟随完整的 Workspace 投影。当 Client 必须修改或跟随 Workspace 导航时，请通过 API 网关使用它。本包同时拥有 `ctx.directoryPickerController` 与生成的 `ctx.remote.directoryPicker` namespace，因为它承载的选目录 seam 是抽象的，自身从不作为 Loader entry。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

Host 控制器会串行执行正确性取决于当前注册表状态的变更，并为预期失败抛出带有稳定错误码的 `RemoteError`。它的 `follow()` 流会同步订阅持久 Workspace 变更，先发出一份完整 baseline，再按顺序发出 `upsert`、`remove`、`order`、`archived`、`pinned` 和 `temporary` 增量。归档、置顶与临时集合都是会话 id 数组，置顶数组把最近置顶的 id 放在前面。重连会以替换 baseline 开始新一代，因此消费方不依赖收到断线期间的每个增量。不带 `stopActivity` 的 `archiveSession` 会以 `workspace/session-active` 拒绝仍有工作在跑的会话，其 details 按族（`turn`、`subagent`、`job`、`schedule`）列出这些工作及各项的 id 与名称；带 `stopActivity: true` 时注册表的提供方先停止这些工作，归档集合持久化后即返回响应，停止在后台收敛。

控制器注入 `remoteAccess`，并经 `typert.resources` 以默认字段 `workspaceId` 登记 `workspace` 资源种类。`workspace/follow` 不读取资源，其调用访问 `global` 资源：principal 不是 owner 的 Peer 只有在其 principal kind 于 [`dsh-api-remote-access`](../remote-access/README.zh.md) 中的 policy 绑定了列出该 action 的 `global` role 时才能订阅它。对这类调用方，baseline、`upsert` 帧与 `order` 中的 id 只保留 `ctx.remoteAccess.allows()` 作为 `workspace` 资源允许的 Workspace，以及它作为 `session` 资源允许的会话 id（各 Workspace 内的会话以及归档、置顶与临时集合），因此 `workspace` role 与 `session` role 也列出同一 action。流记录已下发的 Workspace。某个 Workspace 在下一次变化或新顺序中已不被允许时，流发送一个携带完整过滤后状态的 `replace` 增量帧而不是 `remove`，因为 Client 不会复活已移除的 id；`replace` 是普通增量帧，Client 像开场 baseline 一样整体替换状态，但它不开启新的一代，因此既不报告错误也不重连；访问恢复后，该 Workspace 经普通 `upsert` 重新出现。`remove` 帧表示删除，只发给收到过该 Workspace 的调用方。owner 的帧不过滤。

Client 入口提供 `ClientWorkspaceModel` 和 `createWorkspaceStateStream()`。该模型拥有 Workspace 行、registry 顺序、归档、置顶与临时会话身份、一元变更回显，以及流与一元调用的竞态处理。较新的 Host 行按 `updatedAt` 获胜；已提交的流顺序优先于较旧的一元响应；已经移除的 Workspace id 不会被延迟数据复活。置顶快照仅在会话身份或顺序变化时更新。该包公开与框架无关的快照和订阅，把导航策略与 React 钩子留给 UI owner。`WorkspaceController.archiveSession(sessionId, { stopActivity })` 抛出携带 Host `rpcError` 的 `WorkspaceArchiveError`，界面因此能区分"仍有工作在跑"的拒绝与会话缺失或载体故障，并提议停止这些工作。

<a id="first-use-workspace"></a>
### 首次使用工作区

`workspace.initializeDefault()` 返回持久化的默认工作区；Client service 通过 `workspaces.initializeDefault(signal?)` 提供该操作。它不接受请求参数：固定目录名 `default-workspace` 由 Host 拥有，注册表也以同一路径片段作为初始标题，因此任何语言下同一安装环境都只有一个磁盘路径和一个存储标题。Host 将目录放在其账户的 `<Documents>/deepseek-harness` 下，远程 Web Host 也遵循此规则。操作系统的文件名限制同样适用。Linux 系统查询要求存在 `xdg-user-dir` 且启用了 Documents 目录；不具备该条件的 Host 必须配置 `documentsDirectory` 或使用文件夹选择器。

[Workspace 注册表](../../workspace/workspace/README.zh.md#first-use-workspace)负责资格判断、目录创建和持久化初始化。已有默认工作区直接返回，不再查询 Documents，也不会被重命名或迁移。不满足首次使用条件时返回 `undefined`，启动流程可将目录选择留给用户。查询和创建失败遵循标准 Remote 错误处理。初始化不创建 Session，也不发送消息。

`./default-workspace` 为浏览器消费方导出 `DEFAULT_WORKSPACE_DIRECTORY` 与 `workspaceDisplayTitle(title, localizedDefault)`：仍保留自动标题的工作区按读者语言显示默认名称，其他标题一律原样显示。被用户重命名为 `default-workspace` 的工作区，或从选择器采用的同名文件夹，也会按默认工作区显示；除显示之外没有其他行为依赖该判断。

| 配置 | 默认值 | 用途 |
| --- | --- | --- |
| `documentsDirectory` | 系统 Documents 目录 | 完全限定的 Host 目录覆盖值 |
| `temporaryWorkspaceDirectory` | `<Documents>/deepseek-harness/temporary-workspaces` | 临时会话目录的完全限定根目录；volatile，可在「设置 → 通用」中编辑 |
| `documentsLookupTimeoutMs` | `10000` | 操作系统目录查询的正数最大时长，单位为毫秒 |

Documents 查询占用注册表变更队列，因此其他 Workspace 变更（包括登记已选目录）最多可能等待 `documentsLookupTimeoutMs`。取消可以停止查询；解析成功后，取消不会回滚创建或登记。

<a id="temporary-workspace-root"></a>
### 临时工作区根目录

`temporaryRoot(signal)` 解析每个无工作区会话创建目录所用的根：设置了 volatile 的 `temporaryWorkspaceDirectory` 时用它，否则通过默认工作区相同的平台查询与 `documentsLookupTimeoutMs` 期限回落到 `<Documents>/deepseek-harness/temporary-workspaces`。它会递归创建该目录并用 `fs.realpath` 规范化，使创建路径按会话执行 `mkdir` 时与唯一拼写一致。它不是 Remote verb：只有 Host 的 [Session 创建路径](../../api/session-controller/README.zh.md#temporary-sessions)需要它；配置的目录不是完全限定路径时会大声失败。

该设置是 volatile schema 字段，这正是它出现在设置界面的原因；保持未设置是常态，因此设置行清除用户层，而不是写入一个客户端猜出的值。修改它只影响此后创建的会话——已创建的临时会话保留其已存储的目录。

-----

<a id="model-experience"></a>
## 模型体验

无，因为 Workspace 组织属于浏览器和 Host 的控制状态，并且不注册提示词、工具或会话事件。

#### KV Cache 影响

无直接影响；Workspace 变更不会改变模型请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- `follow()` 在重连后替换完整投影，不提供持久 cursor 或增量追赶协议。
- 进程内删除标记只会在 Client 模型生命周期内阻止延迟数据复活已移除的 Workspace。
- 归档或删除会话时不会移除临时会话的目录；归档只作用于显示层，清理策略延期。
- 修改 `temporaryWorkspaceDirectory` 不会移动或接管已创建临时会话的目录。


<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
