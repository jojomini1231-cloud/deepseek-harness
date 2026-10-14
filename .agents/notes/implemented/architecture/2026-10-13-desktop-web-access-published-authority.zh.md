# Agent Note：桌面端浏览器访问公开在一个外部 authority 下

Status: implemented

[English](2026-10-13-desktop-web-access-published-authority.md) | 中文

## Problem

[桌面端浏览器访问](2026-10-13-desktop-web-access-loopback-port.zh.md)给本机浏览器提供了进入正在运行的应用的入口，并且有意只绑定回环地址。希望从另一台设备访问该监听器的操作者 —— 常见做法是用隧道或反向代理转发到 `127.0.0.1:3080` —— 打开对外的浏览器域名时，会得到 `dsh web authentication required; reopen the URL printed by dsh web.`

它由两项彼此独立的检查产生，而这两者都不是围栏或鉴权的缺陷：

`isTrustedApiRequest`（`packages/client/connection/src/api-request-trust.ts`）只接受回环、监听器自身的绑定地址，以及 `trustedHosts` 中列出的 authority。隧道域名不属于其中任何一类，因此每个 `/api` 调用都返回 `403 forbidden`。索引请求则完全没有围栏：它直接进入 `BrowserAuth.authorizeIndex`，返回纯文本的 `401` 鉴权页。

`BrowserAuth` 签发的是 host-only 会话 cookie，其名称与载荷都绑定签发它的 authority（`packages/client/connection/src/browser-auth.ts`）。在 `127.0.0.1:3080` 上取得的 cookie 既不会被发送到隧道域名，在那里也不被接受；而启动令牌兑换只在一个路径上应答：携带令牌的 `GET /`，随后重定向到 `./`。因此从公开 authority 访问该部署的浏览器必须在那里重新完成一次兑换，而这需要操作者持有携带本进程启动令牌的 URL。

Web profile 本就为这两半各有一个旗标 —— `--trusted-host` 接受某 authority，`--public-url` 发布根地址 —— 但桌面壳两者都没有提供，而 Host 子进程只上报自己的回环 URL，因此壳层既无法触达这些旗标，也无法发出一条可完成鉴权的链接。

## Decision

设置 → 通用设置 → **浏览器访问**新增一个可选的**信任域名**字段，存为 `userData/desktop/settings.json` 中的 `web.trustedHost`。它接受裸 `host[:port]`，或路径为代理会剥掉的挂载前缀的完整 `http(s)://` URL。Electron 在 `webAccessBindArgs`（`apps/desktop/src/web-access.ts`）中由这一个值推导出两个 Web profile 旗标，并仅在设置开启时把它们追加到 Host 子进程的 argv，因此未公开的监听器绑定的内容与之前逐字节一致。

一个值，而不是两个。这两个旗标不可互换 —— 围栏接受的是 authority，而发布的根地址是浏览器实际打开、也是启动令牌兑换必须落到的地方 —— 因此分别暴露它们会让操作者配置出「围栏接受了浏览器从不使用的 authority」或「发布了围栏拒绝的根地址」这类部署。由单个 authority 推导两者，使半配置状态无法表达，代价是不支持「发布根地址的围栏 authority 与之不同」的情形（即代理改写 `Host`）。

该字段被校验三次，每层只负责自己能强制的那部分。设置行检查形态，使草稿立即失败；`webAccessSection` 在读取时校验已存值，并通过文档级回退上报；`parseWebAccessEndpoint` 是写入处理器调用的那个，因此原因能到达用户。围栏接受什么仍由 Host 决定，`client-connection` 加载 `trustedHosts` 时依旧会拒绝它无法解析的 authority。authority 被归一化为 URL host，即浏览器在 `Host` 中实际发送的内容：scheme 默认端口与多余的结尾斜杠是唯一被接受的改写，其余 WHATWG 会改写的取值一律显式失败，而不是变成一个围栏永不匹配的 authority。

启动令牌仍不会传给渲染进程。`status()` 以 `publicAddress` 上报公开根地址，不含令牌；新增的 `copyLink()` 处理器在主进程内构造 `<公开根地址>?token=<令牌>` 并写入系统剪贴板，不返回任何内容。

## Alternatives considered

**用两个字段 `trustedHost` 与 `publicUrl`。** 表达力更强、也更贴近旗标，但它让上述半配置状态变得可表达，并要求操作者手工维持两个值一致。桌面壳自身的监听器没有理由出现「围栏 authority 与发布根地址不同」的部署。

**复用 `open()` 打开公开地址，而不新增复制动作。** 该按钮现在打开的就是回环 URL，而在这台机器上打开*公开* URL 会针对隧道而非监听器完成鉴权，这很少是操作者想要的。更关键的是，需要搬运的是携带令牌的那个 URL 本身：操作者要把它拿到另一台设备上，而剪贴板上的链接正是把它送过去的方式。

**改为绑定局域网的网卡地址。** [回环决策](2026-10-13-desktop-web-access-loopback-port.zh.md)已经否决了这一点。它会把端口暴露给整个网络，而不是暴露给某一个具名 authority，而且没有任何围栏配置能让监听器本身变得不那么可达。

**让 Host 子进程上报公开 URL，由 Electron 据此推导链接。** `apps/desktop-host/src/index.ts` 用硬编码的回环地址构造其就绪 URL，改动它会让桌面窗口自身的 origin、cookie 和启动注入都依赖于发布的根地址 —— 这正是回环决策所避免的耦合。改为由壳层推导公开链接，而令牌无论如何都是同一个进程凭据。

## Consequences

启用该域名会让整个监听器对这一 authority 放行，因此隧道转发的每个请求在围栏看来都是可信的；鉴权仍然起决定作用，没有 cookie 或令牌的浏览器依旧被拒绝。复制出的链接是有效凭据：其查询串携带启动令牌，且与直接交给浏览器的 URL 不同，它会留在系统剪贴板中，剪贴板管理器或系统剪贴板同步可能长期保留。这两点都由[桌面端参考](../../../../apps/desktop/README.zh.md#web-access-for-this-machine-s-browsers)说明。

非回环的受信 authority 会翻转 `connection.allowsRemoteAuthorities`，使 `directory-picker-auto` 挂载浏览器内选择器而非本机原生对话框。这不是靠固定为原生后端能解决的：一个 Host 同时服务两个客户端，而远端浏览器看不到本机的选择器。因此配置域名期间，桌面窗口改为浏览目录，同一篇参考亦有说明。

与端口一样，该字段是壳层自有的启动期偏好，在下次启动时生效，在那之前该行报告 `restartRequired`；已存值必须在读取时有效，因为它是在拼装子进程 argv 时被消费的，在那里抛错会中止启动，而不是回退到默认值。
