---
kind: upgrade-guide
description: "HostConnectionHandle 契约新增必填成员 attachBrowserDevices，Web profile 新增 devices Remote 命名空间与对应设置页。"
---

# 浏览器设备名册

[English](guide.md) | 中文

## 变更

组合了 Connection 浏览器载体的 Web 部署，现在会记录每一个完成启动令牌交换的浏览器。新的 Host 包 `@deepseek-ai/dsh-api-device-controller` 把名册保存在 Session 数据之外的 `browser_devices` 存储域中，因此吊销能跨 Host 重启保留，并提供 `devices` Remote 命名空间。签名浏览器 cookie 可选地携带其登记的设备，绑定了已吊销设备的 cookie 会在下一次请求时停止认证。持有已打开 WebSocket 的浏览器在被吊销后，该连接会持续到传输重连或页面刷新为止，因为准入发生在升级握手时。

设置页的设备管理列出这些浏览器，并提供重命名与吊销。它只在 Host 提供 `devices` 命名空间时注册，因此没有该控制器的部署看不到任何痕迹。

## 迁移

1. **`HostConnectionHandle` 新增一个必填成员。** 任何实现该导出接口（而非断言为它）的代码都要补上 `attachBrowserDevices(store: BrowserDeviceStore): () => Promise<void>`。只消费 `ctx.connection` 的组合无需改动：除非加载 `device-controller` 行，Connection 不挂载任何名册。
2. **在浏览器可达的部署中组合该控制器。** [`packages/bundle/web-app`](../../../../packages/bundle/web-app/cordis.patch.yml) 补丁已经这样做了。自行搭建 Web 组合的 profile 在 `@deepseek-ai/dsh-client-connection` 与 `@deepseek-ai/dsh-storage-domain` 旁添加 `@deepseek-ai/dsh-api-device-controller`；没有浏览器载体时该包处于未激活状态，不提供服务。
3. **本次变更之前签发的 cookie 继续可用。** 载荷中没有设备 id 的 cookie 与以往完全一致地认证，且不属于任何一行，因此无法按设备吊销；只有再次完成启动令牌交换的浏览器才会获得可吊销的身份。
4. **吊销之后启动的 Host 不再接纳已吊销的浏览器。** 名册一经读出即为准；在此之前，未读出的名册最多在存储挂载后的 `rosterLoadGraceMs` 内接纳设备（条目未设置时默认十秒），打开失败后则一律不接纳。因此预期会有一段短暂窗口：被上一个进程吊销的浏览器仍可认证，随后被拒绝。
5. **名册受 `maxDevices` 限制（默认 100）。** 登记超出上限时，最近一次认证请求最早的设备会被淘汰并删除其记录，因此不断登记浏览器的部署会丢弃最闲置的那些，而不是让持久表无限增长。当需要同时保留一百台以上可吊销浏览器时，请在 `device-controller` 条目中调高 `maxDevices`；被淘汰的浏览器会以新设备身份重新登记并被接纳。
6. **设备标签按 UTF-8 字节数设限。** `rename` 最多接受 64 字节，因此由星光平面或组合字符构成的标签与纯 ASCII 标签受同样的存储大小限制。更长的标签会返回 `devices/rejected`。
7. 确认该条目加载无激活错误、设置页出现「设备管理」页，并在其中吊销一个浏览器后它在下一次请求时退出登录。
