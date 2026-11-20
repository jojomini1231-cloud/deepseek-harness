---
description: "为等待用户输入的会话、以及回合结束时尚未读出的结果发送操作系统通知。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-session-notifications

[English](README.md) | 中文

## 概述

当会话开始等待用户输入、或回合结束时结果尚未读出，发送浏览器或桌面通知。插件只读取客户端的会话状态表，因此它报告的都是工作区侧栏已经在显示的事实，自身不新增任何 Host 状态。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包

Web 打包已包含本插件，profile 中以 `ui-session-notifications` 这一行列出。它不向任何 slot 提供内容、不渲染元素：它订阅 `uiSession.sessionStatus`，把状态迁移转换成操作系统通知。

插件激活后的第一份状态表只是基线，不发送任何通知，因此启用插件不会补报早已在等待或早已未读的会话。基线之后，某会话的待交互项以新的 `key` 出现时，会为该等待发出一条通知；某会话的完成结果变为未读时，会发出一条通知，区分失败与成功。同一次迁移里，新的待交互项优先于该会话的未读完成，且每个事实只通知一次：重复同一个待交互 `key`、或未读状态保持不变，都不会再发。离开状态表的会话会丢弃其游标，之后的等待或完成重新计数。

标题取会话当前的 `displayTitle`，缺失时回退到本地化的 `untitled`。正文说明事实类别，通知 tag 为会话标识，因此替换不会无限堆叠。点击通知会关闭该通知、聚焦窗口，并通过 `uiWorkspace.openSession` 打开对应会话。

`notifyOnlyWhenUnfocused` 默认为 true，当页面可见且已聚焦时抑制所有通知，因为工作区侧栏已经把这些状态显示在屏幕上。窗口可见但未聚焦、或标签页在后台时，仍会通知。

插件在第一次需要发送通知时申请通知权限；申请获准后立即补发这条触发申请的通知。权限被拒绝后，本轮会话内插件保持静默且不再申请；运行环境没有 Notification 构造函数（例如无头浏览器）时同样静默。

`notifyPendingInteraction` 与 `notifyCompletion` 分别开关两类通知，三个字段都是 Host 条目 Config 的 volatile 成员，因此 `cordis.yml` 的改动无需重挂插件即可到达已打开的页面。通知状态只存在于内存：不写入浏览器存储，也从不进入会话日志。

<a id="model-experience"></a>
## 模型体验

无。通知属于客户端呈现事实，不会进入模型请求或会话日志。

#### KV Cache 影响

模型请求前缀不变。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 插件只依据客户端状态表通知，因此没有页面打开期间发生的等待或完成不会发出任何通知；未来若增加 Host 侧通知器，可以覆盖窗口关闭的情况。
- 完成通知沿用侧栏的聚焦规则：用户正在阅读的会话不会被置为未读，因此读完一个回合不会产生通知。
- 浏览器隐藏 Notification 构造函数的环境不支持通知；此时插件保持静默，而不是退化为页面内横幅。

<a id="dev-note"></a>
### 开发备注

迁移规则实现为纯函数，无需浏览器即可测试；插件测试用脚本化的状态表、权限状态与聚焦状态，在 jsdom 中覆盖每个分支。
