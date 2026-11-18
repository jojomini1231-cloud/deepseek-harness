---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-11-05-timeline-priority-notice

[English](2026-11-05-timeline-priority-notice.md) | 中文

## 概述

记录用户添加或取消紧急优先级时的时间线通知。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-11-05-timeline-priority-notice
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-11-03-conversation-rewind-source"
    after: "8a6161569bae374e885cdc510e51daf98289ca0a25c46a904d7d0db0380481cf"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-11-03-conversation-rewind-source"
    after: "0ca428ae7b2dc2ac0e074a0aae83379bd0d6b6fa031b5c5e8b8c5d06a7122f83"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-11-03-conversation-rewind-source"
    after: "143bd9315db1ae102dead6400ca9ada98dc957e58097705bfcd8db8e8bc62de3"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-11-03-conversation-rewind-source"
    after: "3ef8a40b4aeae019580eaded7000d5e4a0fce0461c44001054b468020bfae287"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

已有消息保留原有来源和含义。时间线通知包含普通文本和来源标签。未加载时间线的读取方可保留未知来源并读取文本，无需应用任务更新。时间线将任务树、报告和讨论保存为会话日志中可忽略的 `plugin:timeline/*` 记录。未加载时间线的读取方会跳过这些记录。

<a id="verification"></a>
## 验证

时间线优先级测试验证仅用户修改紧急优先级时才排入通知。进程恢复测试验证写入进程意外退出后仍可恢复时间线状态。

<a id="dev-note"></a>
## 开发备注

无。
