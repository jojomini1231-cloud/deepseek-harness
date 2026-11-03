---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-11-03-conversation-rewind-source

[English](2026-11-03-conversation-rewind-source.md) | 中文

## 概述

新增 `conversation-rewind` 消息来源，由撤回或对话编辑记录在空内容的 developer 标记上。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-11-03-conversation-rewind-source
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-10-13-liveshare-share-viewer-principal"
    after: "82b1a321bd2bffbd80a6c7293d9f0255f00c37d13d4d73ee5acfff2dc7887b90"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-10-13-liveshare-share-viewer-principal"
    after: "ca95c28d51c7c012048f9c196589447efb210e922f5a2488862a17d184c3bbcf"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-10-13-liveshare-share-viewer-principal"
    after: "e31d8ead75e13e76b41165526f3e26dae55834eca94699f5f0977b1b83341b4a"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-10-13-liveshare-share-viewer-principal"
    after: "36d181a3b3ba581dbea24d460168a61b3ec1fb2df76adf92b2c230acbbf436ac"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

新的写入方只在内容为空的 `developer/message` 上使用该来源，因此没有任何推导出的模型可见消息依赖解释它；同一条标记进入 Inbox 时也保持同样形态。旧读取方把未知的可合并扩展来源类型当作不透明生产者元数据保留记录，因此既有记录含义不变，也无需改写读取方。该来源携带被撤回的目标序号，仅用于展示。

<a id="verification"></a>
## 验证

pnpm exec vitest run --project thread-safe packages/api/session-controller/tests/commands-rewind.host.spec.ts：9 个测试通过；pnpm exec vitest run --project thread-safe packages/api/session-controller/tests：1109 个测试通过。

<a id="dev-note"></a>
## 开发备注

无。
