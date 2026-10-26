---
description: "用 git 工作树快照和文件工具编辑前后的整文件捕获汇总每个顶层轮次改动的文件，以 workspace/changes Session 事件宣告，并在 Session 存活期间提供摘要和逐文件对比，以及 Files 工作台读取的只读仓库历史；配置、仓库要求与覆盖规则。"
kind: "package-reference"
---

# @deepseek-ai/dsh-workspace-changes

[English](README.md) | 中文

## 概述

本插件汇总每个顶层轮次改动的文件，并提供每个所列文件在轮次开始与结束时的内容对比。对比轮次开始和结束时的 git 工作树快照；文件工具编辑的每个文件在实际修改前复制一份整文件，轮次结束时再复制一份，以此覆盖 git 覆盖不到的文件。没有仓库或没有 git 时，只列文件工具的编辑。它还为 Files 工作台提供只读的仓库历史：ref、分页提交、提交详情和提交文件对比。Session 日志只收到一条写明轮号的 `workspace/changes` 事件；摘要、对比和历史留在 Host 上，由 Web 的改动文件卡片与历史视图渲染。

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

正式提供的 Web bundle 挂载本插件。任何具备 `subprocess` 能力且 Host 上有 git 可执行文件的组合都可以挂载它：

```yaml
- name: '@deepseek-ai/dsh-workspace-changes'
  config:
    maxFiles: 500
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `timeoutMs` | `30000` | 单条 git 命令允许运行的毫秒数，超时则放弃本轮记录或该次历史读取 |
| `outputMaxBytes` | `8388608` | 每条命令保留的 git 输出字节数，diff 列表更大时放弃本轮记录，历史输出更大时该次读取失败 |
| `maxFiles` | `500` | 单份摘要或单份提交详情携带的最大文件数，以及工作区状态视图两个分组各自的最大条目数；`total` 仍报告完整数量 |
| `maxCommits` | `100` | 单页历史携带的最大提交数；请求更大的页时按此上限截断 |
| `maxFileBytes` | `2097152` | 文件在文件工具编辑前后被捕获、或从快照读出做对比所允许的最大字节数；更大的文件不提供对比，其中在文件工具编辑前后被捕获的也不带行数 |
| `diffTimeoutMs` | `100` | 逐行对比允许运行的毫秒数，超时后退化为整文件替换 |

本插件需要 `subprocess` 与 `fs` 服务。有工作目录且不是子代理来源的 Session 都会被记录；子代理 Session 不记录。快照通过私有 index 写入 Session 自己拥有的临时对象目录，仓库自己的对象库以只读 alternate 的方式挂接；仓库的 index、对象、工作树和 ref 保持不变，用户此前未提交的改动也不会进入摘要。Session 释放时删除该目录。工作目录内的嵌套仓库和 submodule 记录为 gitlink，其内部改动不会出现。不在任何 git 仓库内的工作目录不做快照。没有 git 时——或者 macOS 上只有 `/usr/bin/git` 的开发者工具桩程序时——同样定位不到仓库，插件记录一次日志。两种情况下摘要都只列下文所述的文件工具编辑，并以工作目录作为工作区；shell 的改动不会出现。

在 `write`、`edit` 或有修改作用的 `str_replace_editor` 调用解析目标并取得修改防护之后，记录器在实际修改前把该文件复制到 Session 的临时目录，每轮每个路径只复制第一次，轮次结束时再复制一次；副本按其字节的 SHA-1 命名，相同内容只存一份。这一步不需要 git。仓库定位与显示路径保留原始项目；即使 Session 切换目录，文件捕获仍跟随该操作已解析的目标。快照覆盖到的路径保留 git 的行数；其余路径由副本提供，也就是匹配忽略模式的文件、仓库之外的文件，以及没有快照时的每一次文件工具编辑，行数来自两份副本的逐行对比，因此同一文件的重复编辑只计一次，文件工具编辑之后的 shell 改动也包含在内。轮次结束时内容没有变化的路径不会列出。超过 `maxFileBytes` 的副本不会保存：该文件列出时带 `oversized`，没有行数；两侧都这么大的路径同样列出，因为没读过的内容永远不能认定为没有改动。只差一个末尾换行的路径对比为两侧相同，而 git 仍会把那一行计入行数。`/tmp` 与平台临时目录下的文件被排除，除非它们位于仓库内。快照覆盖范围之外只通过 shell 命令做出的改动不会被记录。

每个文件携带持久的 `path`——位于工作目录内时为相对路径，否则为绝对路径——以及用于排序和标签的 `display` 路径：相对路径，仓库内位于工作目录之上的文件为 `../` 路径，家目录下的文件为 `~` 路径，其余为绝对路径。文件按 `display` 的码元顺序排序，因此上级路径和绝对路径排在工作目录自身文件之前。`workspace/changes` 事件只携带轮号；`ctx.workspaceChanges.summary(sessionId, seq)` 返回该序号的事件宣告的摘要，Session 已释放或本 Host 进程从未记录时返回 undefined。`ctx.workspaceChanges.diff(sessionId, seq, index, signal)` 对比该下标所列的文件：从两棵快照树或两份副本得出带三行上下文的 hunk；git 报告为二进制或某一侧含 NUL 字节时返回 `binary`；某一侧超过 `maxFileBytes` 时返回 `oversized`。逐行对比运行超过 `diffTimeoutMs` 时退化为一个替换全部行的 hunk，并标记 `coarse`。因此 Host 重启后重新打开的对话，先前轮次既没有卡片也没有对比。

`ctx.workspaceChanges.workingTree(cwd, signal)` 读取工作目录本身而不是某个已记录的轮次，供 Files 工作台的 git 视图使用：一次限定在 `cwd` 的 `git -c core.fsmonitor=false status --porcelain=v1 --branch -z --untracked-files=all`，路径相对 `cwd`，已跟踪的改动与未跟踪文件各自最多 `maxFiles` 条，`total` 保留完整数量，重命名或复制的原路径放在 `from`。不在 git 工作树内的工作目录返回 `not-a-repository`；没有 git，或刷新无法完成时返回 `unavailable`。`ctx.workspaceChanges.workingDiff(cwd, { path, from?, complete? }, signal)` 返回 git 针对一个改动路径与 `HEAD` 的自身补丁，因此重命名、行尾与 clean 过滤器、符号链接都按 git 的方式读取，`coarse` 始终为 false。其 hunk 在每处改动周围带三行上下文；`complete: true` 则让对比覆盖整个文件，未改动的每一行都以上下文行返回。这些读取不运行仓库配置的程序：状态探测禁用 `core.fsmonitor`，对比禁用外部 diff 驱动和 textconv。`HEAD` 不包含的路径与 `/dev/null` 对比，覆盖未跟踪文件和没有提交的仓库；链接按其文本而不是目标对比。任意一侧超过 `maxFileBytes`，或补丁超过 `outputMaxBytes` 时，对比为 `oversized`；git 报告二进制补丁时为 `binary`。路径或原路径位于 `cwd` 之外——无论是直接拼写还是经由目录链接到达——或 git 失败时返回 undefined。

`ctx.workspaceChanges.historyRefs(cwd, signal)` 列出 Files 工作台历史视图可选的 ref：本地分支、远程分支和标签，按 git 的顺序排列，去掉远程仓库的符号 `HEAD`；附注标签剥离到它指向的提交，当前检出的本地分支带 `head: true`。`ctx.workspaceChanges.history(cwd, { ref?, skip, limit }, signal)` 读取一页：ref 必须命名上述 ref 之一，省略时走 `HEAD`；`skip` 与 `limit` 必须是安全整数，大于 `maxCommits` 的请求按该上限截断，提交按 git 的拓扑顺序从新到旧排列，`hasMore` 报告本页之后是否还有提交。没有任何提交的仓库返回空页。拓扑遍历读取的是提交图，而不是在本页最后一个提交处停止，因此开销取决于仓库的历史长度而非页大小；git 从 `git clone`、`git gc` 与 `git commit-graph write` 生成的 commit-graph 文件作答，没有该文件的仓库每次翻页和刷新都要付出一次完整的图遍历。

`ctx.workspaceChanges.commit(cwd, hash, signal)` 读取一个提交，`hash` 不指向提交时返回 undefined：完整与简短哈希、父提交、作者与作者日期、标题、去掉 git 末尾换行的完整提交说明，以及该提交相对第一父提交改动的文件，根提交与空树比较，合并提交与其第一父提交比较。每个文件带工作目录相对的 `path` 与 `display`、重命名时在 `from` 中给出同样位于 `cwd` 内的原路径、A/M/D/R 类型、行数和 `binary` 标记；`cwd` 之外的文件被丢弃，`total` 只统计其中的文件，列表上限为 `maxFiles`。`ctx.workspaceChanges.commitDiff(cwd, { hash, path, from?, complete? }, signal)` 把其中一个文件与第一父提交对比，返回与 `workingDiff` 相同的对比形式与相同的 `complete` 范围：`before` 与 `after` 取自 `/dev/null` 一侧，二进制补丁为 `binary`，超出输出上限的补丁为 `oversized`，路径超出 `cwd`、提交未知或路径没有可对比内容时为 undefined。

这些读取都是只读的：它们对仓库运行 git，不写 ref、对象、index 或配置，并禁用外部 diff 驱动、textconv、签名显示与 git notes，因此仓库配置既不能运行程序，也不能改变解析出的字段。仓库未提供的 ref、超出安全整数范围的页码参数或 git 失败会抛出错误；Files 工作台通过其已认证路由 `/api/git.refs`、`/api/git.history`、`/api/git.commit` 与 `/api/git.commit-diff` 读取这些方法，路由校验与浏览器视图见[它的 README](../../client/ui-sidebar-files/README.zh.md)。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

每个 Session 一个 `TurnRecorder`，串行化其 git 工作。`turn/start` 排入基线：`rev-parse` 每个 Session 只定位一次仓库并创建 Session 的临时对象目录，然后以仓库 index 为种子在临时 index 上执行 `add --all --ignore-errors` 与 `write-tree` 得到 tree id；不可读的文件被跳过并以 git 的退出码 1 报告，快照接受这个退出码。每轮持有自己的状态对象，因此被中断的轮次仍在运行的记录会在下一轮开始后保留自己那一轮的文件。每条命令都带 `GIT_OBJECT_DIRECTORY` 指向临时目录、`GIT_ALTERNATE_OBJECT_DIRECTORIES` 指向仓库的 objects，因此已提交内容从仓库读取，新对象不会落进仓库。每次 `tools/pre-execute` 都等待该队列，因此没有修改能先于其基线发生；文件系统的 `fs/write-intent` 与 `fs/edit-intent` waterfall 委托防护决策，然后排入并等待对已解析目标的捕获，确保副本先于修改，`tool/result` 事件只标记本轮有结果需要记录。`agent/turn-stopping` 在轮内记录：第二次快照、两棵树之间的 `diff-tree -r -M --numstat`、对工作树内已捕获路径的 `check-ignore`、对每个未覆盖路径的第二次复制与逐行对比、追加事件，以及按事件序号保存摘要和每个所列文件两侧的内容来源，即快照树中的路径或一份副本。对比在被请求时计算：`ls-tree -l` 定位快照一侧并取其大小，`cat-file blob` 在 `maxFileBytes` 之内读出，副本从磁盘读取，两侧随后走同一个带超时的逐行对比。`turn/end` 仅在最后一次记录尝试之后仍有工具结果结束时再次记录，这覆盖了中止、失败和被转向的轮次，且不会重复一次失败的尝试；早先记录之后的空列表会取代它。仓库的 index 只读取。

git 通过 `subprocess` 能力运行，使用净化后的环境、`GIT_CONFIG_COUNT=0`（凭据清理会移除索引配置的键，因此不继承这些环境配置）、`GIT_TERMINAL_PROMPT=0`、`GIT_OPTIONAL_LOCKS=0`、配置的超时与有界输出。任何步骤失败都会放弃本轮记录并给出警告；下一轮重新开始。Session 释放与插件释放会中止排队的工作、忘记摘要并删除临时目录。

历史读取与轮次记录器相互独立：每次调用在 Session 工作目录、或 `rev-parse` 报告的仓库根上运行一组固定的 git 命令，解析 `log -z`、`show -s -z`、`for-each-ref --format` 输出中的 NUL 字段，以及 `diff-tree -r -M -z --numstat` 与 `--raw` 的 NUL 记录。差分在仓库根上把提交与第一父提交比较、根提交与空树比较，使 pathspec 保持相对于仓库根；文件列表和对比通过 `--show-prefix` 映射仓库路径，补丁交给与 `workingDiff` 相同的解析器。每条命令都以 argv 数组运行，带配置的超时与输出上限，diff pathspec 使用 `GIT_LITERAL_PATHSPECS=1`；git 失败会抛出错误并由 Files 工作台按服务端错误处理，未知提交或路径仍返回 undefined。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [Web 产出物](../../client/ui-deliverables/README.zh.md)——读取所提供摘要并打开其文件的改动文件卡片。
- [Files 工作台](../../client/ui-sidebar-files/README.zh.md)——读取所提供改动、工作树状态与历史的 Web 视图。
- [子进程能力](../../subprocess/README.zh.md)——git 运行所经过的接缝。
- [历史本轮改动文件卡片决策](../../../.agents/notes/archived/feature/2026-09-11-turn-changed-files-card.md)——快照设计、覆盖规则、暂缓的影子仓库与被否决的备选方案。

<a id="model-experience"></a>
## 模型体验

无，因为记录器只追加一条仅写日志、只有客户端读取的 `workspace/changes` 事件，不注册任何面向模型的内容。

#### KV Cache 影响

这里的内容不会进入模型请求，因此不影响提供方缓存复用。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- 摘要、快照树与捕获的副本只在本 Host 进程内随其 Session 存活；Host 重启后重新打开的对话，先前轮次既没有卡片也没有对比。这是既定行为：Host 已经打不开内容的卡片不显示。
- 有两个 git 功能在快照期间仍会写入仓库自己的 git 目录：`core.splitIndex` 会写 `sharedindex.*` 文件，git-lfs 会对改动文件运行 clean 过滤器并把对象存到 `.git/lfs` 下。
- 需要 git 2.13 或更高版本以支持 `rev-parse --absolute-git-dir`；不支持的仓库格式或其他 git 失败会带着警告放弃本轮，而不是被当成普通目录。
- Session 的首次快照会把工作树里所有未跟踪且未被忽略的文件写进 Session 的临时目录；没有 `.gitignore` 却带着大体积构建产物的仓库，在 Session 释放前会占用同等的临时空间。
- 用户在轮次进行中自己做的编辑会被算到该轮。
- 不在任何 git 仓库内的工作目录只列文件工具的编辑，卡片里因此没有 shell 改动；Harness home 下的影子仓库暂缓，直到其排除规则能可靠地代替缺失的 `.gitignore`。
- 快照覆盖范围之外只捕获文件工具点名的路径：那里只被 shell 命令改动的文件不会出现，在首次文件工具调用之前被两者都改过的文件从该调用起开始对比。
- 每次文件工具编辑都会把整个文件复制一次，每轮每个路径一次，上限 `maxFileBytes`，即使快照也覆盖该路径；副本随 Session 的临时目录一起删除。
- 对比会把所列文件的完整文本送到客户端，包括被忽略的文件、工作目录之上的仓库文件和工作区外的文件；摘要路由只送路径和行数。必须把这类内容留在 Host 上的部署应把本插件组合出去。
- 退化为整文件替换的对比携带两侧的全部行，最多两倍 `maxFileBytes`。
- Windows 路径在 `path` 中保留原生分隔符；`display` 始终用斜杠分隔。
- 当索引条目已删除但文件仍以未跟踪状态存在时，git 会为同一路径报告两条记录；视图按已跟踪记录只列出该路径一次，因此该行及其对比显示删除，未跟踪文件自身的内容不在其中列出。
- 历史只列已提交对象：未提交的工作树改动出现在 git 视图而不是历史中；提交的文件与对比只限 Session 工作目录内的路径。
- 历史只用 git 默认相似度检测重命名，不检测复制：低于阈值的重写会显示为一条删除加一条新增，复制显示为新增路径。
- 提交对比不预先估量两侧大小：补丁大于 `outputMaxBytes` 与三倍 `maxFileBytes` 加 64 KiB 中较小者时报告为 `oversized`。
- ref 列表与翻页读取是两次独立读取：两次读取之间被删除或移动的 ref 会让该次翻页读取失败，直到视图刷新 ref。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
