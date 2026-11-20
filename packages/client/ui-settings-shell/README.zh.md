---
description: "dsh Web 客户端插件页上的终端执行器设置页（命令超时与单流输出上限），以及通用设置里的 Windows pwsh/Git Bash 选择行。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-shell

[English](README.md) | 中文

## 概述

在侧栏打开**插件**，在官方分组里选择**终端**，即可设置单条命令允许运行多久、每条输出流在内存里保留多少。页面暂存输入、只在保存时写入，标明用户覆盖过的值，并允许重置回部署默认值。页面只在 Host 服务 `shell` 命名空间期间存在，没有本地终端执行器的部署看不到它。在 Windows Host 上，本包还会在通用设置里增加**命令行终端**一行，用于在 PowerShell 与 Git Bash 之间选择。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

官方分组里的**终端**卡片打开这一页。**命令超时（毫秒）**终止运行更久的命令；**单流输出上限（字节）**把超出的输出转存到临时文件。两个字段都显示生效值，即用户覆盖值叠在组合默认值之上；用户覆盖过的字段带**已覆盖**标签，旁边是**恢复默认**。点击**保存**之前不会写入任何内容；离开页面即丢弃草稿，清空字段并保存等于重置，填了不是数字的文本则保存被阻止，并在字段下说明原因。

在 Windows Host 上，通用设置会多出**命令行终端**一行：选择**PowerShell** 或 **Git Bash** 会在一次 profile 变更中同时翻转两侧的执行器与工具行，因此任何时刻只组合一个终端。未找到安装前**Git Bash** 保持禁用；非 Windows Host 上该行自隐藏。切换需要重启或被其他配置层覆盖时，结果以 toast 提示。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

宿主半侧是一个空的 `apply`，只为让本包占一条 Loader 行，客户端模块系统据此送出浏览器半侧。浏览器半侧通过 `ctx.configForms.get` 绑定当前平台组装的 shell 执行器条目（非 Windows 为 `bash-sandbox`，Windows 为 `pwsh-sandbox`），用 `ui-primitives` 的共享 `SettingsFormModel` 在 `ShellCardController` 里维护暂存表单，并通过 `ctx.configForms.whileServed` 把 `ShellCard` 注册进插件页的 `plugins.item` slot：Host 服务任一执行器条目时注册，停止服务时注销。页面文案在本包的 `settings.shell` 字典里；`SettingsForm` 框架的文案以 props 传入。

Windows 选择行位于同一浏览器半侧：`ShellChoiceSource` 通过 `pluginManager` 的 Remote 端点读取并切换选择，监听 `plugin-manager/changed` 刷新，并在 `ctx.remoteAccess.whenAccess` 下把 `ShellChoiceRow` 注册进通用设置的 `settings.general.item` slot，因此行与 toast 只在 Host 服务插件管理器期间出现。Host 报告选择不受支持时该行不渲染任何内容。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [ui-plugin-manager](../ui-plugin-manager/README.zh.md)——插件页以及本页注册进去的 `plugins.item` slot。
- [ui-settings](../ui-settings/README.zh.md)——本页依赖的设置 scope 与"命名空间被服务期间"的监视。
- [ui-primitives](../ui-primitives/README.zh.md)——本页渲染的设置表单模型与字段。
- [bash-local](../../shell/bash-local/README.zh.md)——注册 `shell` 命名空间的执行器。

-----

<a id="model-experience"></a>
## 模型体验

无，本包是浏览器侧的设置界面，不注册任何模型面。

#### KV 缓存影响

无；本包既不组装也不发送提供方请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **页面跟随组合进来的执行器**——POSIX 与 PowerShell 两个执行器家族共用 `shell` 命名空间，因为一台主机只组合其中一个，所以服务出来的 schema 因平台而异（PowerShell 多一个 `pwshPath`），而页面在两个平台上编辑的都是同样两个字段。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
