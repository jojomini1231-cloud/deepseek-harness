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
    previous: "2026-10-27-retry-control-input"
    after: "929f58aa2d47a73d6c4717a1e32a3692e98c780eff38c2bb2ddc2e256c7cca97"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-10-27-retry-control-input"
    after: "90eea3e13bf48c0feed7130230eb361d642c5117030b82ef37eeb7151da9d561"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-10-27-retry-control-input"
    after: "8d6521e118b733c6a12600b83130d077b784663aa6c33e08c3bcc0c43fcf298a"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-10-27-retry-control-input"
    after: "52f70013ff05a571780b4c1b87d296bdc350e7d7b96a85dc1e933be0f1104da3"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

新的写入方只在内容为空的 `developer/message` 上使用该来源，因此没有任何推导出的模型可见消息依赖解释它；同一条标记进入 Inbox 时也保持同样形态。旧读取方把未知的可合并扩展来源类型当作不透明生产者元数据保留记录，因此既有记录含义不变，也无需改写读取方。该来源携带被撤回的目标序号；消费方据此隐藏被撤回的行，且目标不晚于符合继续条件的失败 `turn/end` 时，会撤销空 prompt 继续资格。

<a id="verification"></a>
## 验证

pnpm exec vitest run --project thread-safe packages/api/session-controller/tests/commands-rewind.host.spec.ts：9 个测试通过；pnpm exec vitest run --project thread-safe packages/api/session-controller/tests：1109 个测试通过。

<a id="dev-note"></a>
## 开发备注

无。
