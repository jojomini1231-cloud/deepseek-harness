---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-11-23-merge-rewind-source

[English](2026-11-23-merge-rewind-source.md) | 中文

## 概述

恢复 dev 撤回与编辑功能记录在空 developer 标记上的 conversation-rewind 消息来源类型，叠加在 master 的 cua 通知类型之上。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-11-23-merge-rewind-source
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-11-19-cua-input-notices"
    after: "2007571b478834b3cda56fa0f5e721cbf7b3fe43d9f9674929d54098cf527772"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-11-19-cua-input-notices"
    after: "a72e494296104a5a5ebe9254bfb992c09cb2806dff118ad19cc744c25e6cd260"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-11-19-cua-input-notices"
    after: "2324fac0ecbb031374ff20ceb9690d86304e16e274e0ad04724523ac67548a60"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-11-19-cua-input-notices"
    after: "5b5bede981a4c3aa99ba8d7bd98a5c82de06378a841d4272e15a9d46840eac5f"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

新写入方仅在 content 为空的 developer/message 上发出该 kind，因此没有任何派生的模型可见消息依赖对它的解释；同样标记的收件箱副本也如此。旧读取方把未知的可合并扩展消息来源类型当作不透明的生产者元数据并保留记录，因此既有记录含义不变，也不需要改写读取方。该 kind 携带被撤回的目标序列，消费方仅将其用于显示。新读取方完整保留 master 的 cua 类型与更早的全部记录；两侧的新增汇入同一个联合类型。

<a id="verification"></a>
## 验证

pnpm run verify-persistence-catalog：8 个产物为最新；pnpm run verify-persistence-formats：v0 至 v4 全部校验通过（5 份完整参考）。

<a id="dev-note"></a>
## 开发备注

无。
