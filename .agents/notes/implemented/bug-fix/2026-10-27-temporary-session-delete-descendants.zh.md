# Agent Note: 删除临时 Session 会一并删除其 subagent 后代

Status: implemented

[English](2026-10-27-temporary-session-delete-descendants.md) | 中文

## 问题

`session.delete` 会以 `session/descendants` 拒绝一个拥有 subagent 会话的临时 Session，理由是删掉根会让子会话处于任何界面都无法触达的状态。但同一个动词只接受临时 Session，而临时集合只由临时创建路径写入，因此这些子会话同样没有任何删除入口。结果是：一旦某个临时 Session 生成过 subagent，它就永久无法删除——侧边栏的「删除会话」每次都会失败，用户无法从界面里救出这个 Session。

该拒绝还排在运行中工作检查之前，所以报出来的失败永远是后代这一条，哪怕真正需要先停止的是子会话自己的那一轮。

## 决策

删除会清掉它拥有的整条谱系：对每个 subagent 后代先移除存活 Agent 与存储日志，然后处理根 Session 的日志、它在临时根下的目录以及它在 Workspace 注册表中的分类。后代按由深到浅的顺序处理，顺序取自广度优先谱系遍历的逆序，因此中途失败时根 Session 仍然保留——连同使重试可达的那个临时分类。先删后代的日志也保证了重试收敛：已被移除的子会话不再出现在遍历里，也不会留下任何落在所有可达谱系之外的孙会话。

本操作不认领任何后代目录。subagent 的存储工作目录就是它根 Session 的目录，其叶名正是根自己删除时使用的证明，因此按会话删除目录这一步仍然是根专属的步骤。

`session/descendants` 从 `RemoteErrorDetailsMap` 中移除。运行中工作本就以 `session/active` 拒绝删除，而 Subagent 运行时的 `workspace/session-activity` 监听器会回答任意深度的运行中后代，因此存活的子会话仍会阻塞删除，直到 `stopActivity` 将其停止。

## 备选方案

**把 subagent 子会话标记为临时。** 这能让每个子会话被单独删除，但会把用户从未创建过的行塞进 Temporary workspaces 分区，并把一次用户动作拆成数量不可预测、用户还得自己发现的多个步骤。

**在客户端先删子会话再删根。** 该动词拒绝非临时 Session，所以服务端规则无论如何都要改；放在客户端还会在失败后留下可见的半完成状态。

**保留该拒绝，另加一个动词删后代。** 这个第二个动词只为一种没有界面需要单独表达的场景存在：子会话只能经父会话触达，而父会话正要被销毁。

## 验证

- `packages/api/session-controller/tests/commands-delete.host.spec.ts` 对父、子、孙断言日志删除、Agent 释放与注册表遗忘的由深到浅顺序，并断言某个后代失败时根 Session 及其分类保持不变。
- `apps/web/tests/temporary-workspace.e2e.ts` 通过已发布的侧边栏对话框删除一个拥有已播种 subagent 的临时 Session，并断言两份存储日志与目录都已消失。去掉本决策后该用例失败，行仍然留在侧边栏。
- `packages/client/ui-workspace/tests/session-actions.client.spec.tsx` 固定确认文案，该文案现在会点名子代理会话。

## 影响

- 删除临时 Session 是对整条谱系的破坏性操作：可续跑子会话的历史会随之消失，此后对它 `send_message` 会得到 `subagent/not-found`。
- 在此变更之前被该拒绝卡住的 Session，升级后无需编辑任何文件即可删除；升级指南记录了被移除的错误码。
