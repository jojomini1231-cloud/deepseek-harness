---
kind: upgrade-guide
description: "删除临时 Session 现在会一并删除其 subagent 后代，而不再被拒绝。"
---

# 临时 Session 的删除会带走它的 subagent

[English](guide.md) | 中文

## 变更

`session.delete` 过去会拒绝一个拥有 subagent 会话的临时 Session，并报 `session/descendants`。此后没有任何入口能删除这些子会话：该动词只接受临时 Session，而 subagent Session 从不被标记为临时，因此一旦某个临时 Session 运行过 subagent，它就再也无法删除，侧边栏的删除操作每次都会失败。

现在删除会在同一次操作中清掉这条谱系：先是对每个后代的存活 Agent 与存储日志，然后是根 Session 的日志、它在临时根下的目录和它的分类。后代按由深到浅的顺序删除，因此中途失败时根 Session 仍然保留——连同使重试可达的那个临时分类。`RemoteErrorDetailsMap` 中不再有 `session/descendants`。运行中工作的拒绝规则不变：`session/active` 本就报告正在运行的 subagent 后代，`stopActivity` 会先停止它再继续删除。

本操作从不会认领后代的目录。subagent 的存储 cwd 是它根 Session 的目录，其叶名由根 Session 自己的删除来证明。

## 迁移

1. 从 Host 调用方、SDK 绑定以及在该拒绝之后重试删除的自动化中移除 `session/descendants` 处理；该动词不再返回它，按该 code 收窄的 TypeScript 消费方在删掉对应分支前会编译失败。
2. 存储数据不变。后代日志就是普通 Session 产物，此前被该拒绝卡住的临时 Session 升级后可直接删除，无需编辑文件。
3. 确认删除一个生成过 subagent 的临时 Session 会移除两份 Session 日志及其目录、列表不再留下任何行；并确认同一删除在该 subagent 运行期间仍被拒绝，直到 `stopActivity` 将其停止。
