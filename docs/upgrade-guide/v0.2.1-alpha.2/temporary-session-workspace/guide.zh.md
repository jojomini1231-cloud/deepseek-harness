---
kind: upgrade-guide
description: "可以在没有工作区的情况下开始会话，且 workspace-controller 条目新增 temporaryWorkspaceDirectory 设置。"
---

# 无工作区启动会话

[English](guide.md) | 中文

## 变更

Web 与 Desktop 现在可以发起无工作区的临时会话。侧边栏「新建会话」控件旁新增「新建临时会话」控件，其创建的会话不归属任何工作区：Host 创建 `<临时根>/<会话 id>` 并以其作为该会话的工作目录，该会话出现在侧边栏新增的「临时工作区」区块中，而非某个工作区之下。该区块与「工作区」区块同级，自带搜索框、视图选项与「新建临时会话」按钮，且无论其中是否有会话都会渲染。临时会话日后可以迁移到工作区，但仍留在「临时工作区」区块——该区块按创建入口定义，而非按目录定义。

`workspace-controller` 的 cordis.yml 条目新增 `temporaryWorkspaceDirectory` 设置，可在「设置 → 通用」中编辑。未设置时回落为 `<Documents>/deepseek-harness/temporary-workspaces`。workspace 域的持久状态新增 `temporarySessionIds`，默认为 `[]`。

## 迁移

1. **`workspace-controller` 条目现在必须提供 Config。** `temporaryWorkspaceDirectory` 是必填键，`documentsLookupTimeoutMs` 不再是可选，且插件构造函数不再为参数提供默认值。以编程方式构造（不传参数的 `new WorkspaceController(ctx)`）现在无法通过编译，也无法加载。省略 `config` 块的 cordis.yml 行仍可加载：schema 容忍缺失或空对象，`documentsLookupTimeoutMs` 取自默认值，`temporaryWorkspaceDirectory` 视为未设置。要保留派生默认值，请提供该配置块并写入 `temporaryWorkspaceDirectory: !!js undefined`，或将其指向一个目录。
2. 无需改动任何存储数据：既有 workspace 存储记录因 `temporarySessionIds` 默认为 `[]` 而照常解析。无需重写 profile patch 或 Session 文件。
3. 如需固定临时根目录，在「设置 → 通用」中设置，或在 cordis.yml 的 `@deepseek-ai/dsh-api-workspace-controller` 行中添加 `temporaryWorkspaceDirectory`。
4. 确认该条目加载时无校验错误，且新建的临时会话目录落在配置的根目录之下。
