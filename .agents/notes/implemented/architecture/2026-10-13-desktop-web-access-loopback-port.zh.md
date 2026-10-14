# Agent Note：桌面端在本机回环端口上提供浏览器访问

Status: implemented

[English](2026-10-13-desktop-web-access-loopback-port.md) | 中文

## Problem

桌面应用会把完整的 Web Host 作为子进程运行，但启动该子进程时使用的是 `--port 0`，因此监听端口由系统分配，应用之外的任何东西都无从得知。Electron 通过自己的 `dsh-app://` 载体拨号该端口，并使用 Host 的启动令牌鉴权，其他浏览器无法访问正在运行的应用。希望用普通浏览器标签页查看会话、或在其中直接输入的人，没有任何入口。

其余所需能力都已具备：`session/follow` 为每个查看方各开一条实时流，因此多个客户端可以同时观察同一个会话的执行轨迹；`session/prompt` 通过会话级写入锁，使浏览器可以向桌面窗口正在运行的会话提交提示词。请求信任围栏本就接受回环 authority。唯一缺少的只是一个由用户选定、且用户知道的绑定端口。

## Decision

设置 → 通用设置 → **浏览器访问**把 `web: { enabled, port, trustedHost }` 存进 `userData/desktop/settings.json`，即 Electron 独立于 Host 拥有的壳层配置文档。监听始终留在回环地址，本笔记只负责端口；可选的 `trustedHost` 把该监听公开在一个外部 authority 下，属于[另一项决策](2026-10-13-desktop-web-access-published-authority.zh.md)。Electron 在 `main()` 中读取一次该快照，并通过 `webAccessBindArgs` 由此推导 Host 子进程的绑定参数，因此开启开关、修改端口或关闭开关都在下次启动时生效；当已存选择与正在监听的实例不一致时，该行报告 `restartRequired`。设置关闭时，参数与之前完全一致（`--host 127.0.0.1 --port 0`），应用窗口自身的通路没有变化。

监听只绑定 `127.0.0.1`。服务其他机器会把本应用的远程代码执行暴露到网络上，这正是 harness 直接拒绝通配绑定的原因；设置项不是重新打开它的地方。

启动令牌不会传给渲染进程。`status()` 返回的 `address` 是 `host:port`，不含令牌；`open()` 在主进程内通过 `shell.openExternal` 花费已认证的 URL —— 与既有的更新载体同形：渲染进程只声明动作，主进程持有权限。

该行位于 `packages/client/ui-settings-general`，即已经承载桌面更新桥接的通用设置区所有者，并且仅在 `globalThis.dshDesktop.webAccess` 存在时注册。因此普通 Web 部署永远看不到它，也不需要新包、新 roster 行或新 i18n 命名空间。端口范围分别出现在 `apps/desktop/src/settings.ts` 与该行的注册处；由于该行无法导入 Electron 侧的代码，`apps/desktop/tests/web-access.spec.ts` 把两者钉在一起。

## Alternatives considered

**让端口实时生效，在变更时重新绑定监听器。** 这需要在 `packages/host/webserver` 上新增第二套监听能力 —— 一张路由表对应多个绑定地址、一个鉴权所有者、一道信任围栏 —— 并在 volatile 配置路径上新增一个 Host 插件来绑定与解绑。Host 的端口在任何窗口存在之前就被 `ready.url` 消费，因此实时变更还必须重新签发已认证 URL、启动注入和 Electron Cookie。重启可以免去这一切，而桌面壳自身的设置文档本就记录为下次启动生效。

**绑定该机器在局域网上使用的网卡地址。** 那样 `client-connection` 的 `trustedHosts` 就必须接受该 authority，因为围栏会拒绝未配置的非回环 Host；否则每个 API 请求都会返回 403。这会扩大 harness 有意不默认扩大的暴露面，并且需要单独的安全评审与告警文案，与「给本机自己的浏览器一个入口」是两件不同的事。监听仍然只绑定回环地址；该后续工作即[公开 authority 决策](2026-10-13-desktop-web-access-published-authority.zh.md)，它接受由操作者指定的单个 authority，而不绑定局域网的网卡。

**把端口放到 Host 的 `webserver` 行，并通过插件设置页编辑。** 端口由命令行标志解析进组合后的行，因此设置写入会与启动器自身的取值冲突，而 Electron 壳仍然必须改写子进程的 argv。壳层设置文档本就拥有这类仅启动期生效的偏好。

**直接提供 Web dist，而不复用 Host 监听器。** Electron 已经在转发给 Host，而 Host 已经通过其 fallback seat 提供 dist，并在同一 origin 上提供鉴权、插件 bundle 与 API。再起一个服务器只是重复这些工作。

## Consequences

所选端口已被占用时 —— 最可能是被同样默认 `3080` 的 `dsh --profile web` 占用 —— 会以既有的 `EADDRINUSE` 启动诊断暴露，而不会被静默改到其他端口。这是有意的：浏览器书签悄悄换到另一个端口，比一个说明原因的启动失败更糟。

开启该设置会扩大能够到达此 Host 的范围：本机上任何拿到已认证 URL 的进程都能驱动会话，而该 URL 的查询串携带令牌。令牌仍是每次启动都会变化的进程凭据，监听仍在回环地址上，且该行渲染的地址从不包含它；[桌面端参考](../../../../apps/desktop/README.zh.md#web-access-for-this-machine-s-browsers)说明分享规则。

`web` 字段在启动时读取，因此手工编辑文档与通过设置行操作行为一致：下次启动时应用。`web` 段无效的文档会使校验失败，整份文档回退到默认值，这与既有 `updates` 字段遵循同一规则 —— 一个坏字段不会静默保留一个用户并未选择的端口。`trustedHost` 同样在读取时校验：它是在拼装子进程 argv 时被消费的，在那里抛错会中止启动，而不是回退。
