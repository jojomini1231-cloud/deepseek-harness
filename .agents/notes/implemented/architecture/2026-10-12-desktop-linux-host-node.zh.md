# Agent Note: Run the Desktop Host on the bundled Node on Linux

Status: implemented

[English](2026-10-12-desktop-linux-host-node.md) | 中文

## Problem

读取图片附件会终止打包后的 Linux 应用。Host 进程在 sharp 首次解码位图时以 SIGSEGV 退出，壳层只报告 `dsh desktop host stopped`，旁边是 sharp 关于 Electron Linux 二进制的加载期警告。

缺陷根源是 GObject 类型系统冲突。Electron 的 Linux 二进制链接系统 GLib，并从其中解析自身的未定义 GLib 符号，因此系统 `libgobject` 占据了进程全局符号命名空间。打包的 `sharp-linux-x64.node` 把 `g_object_unref` 及其同类留作未定义符号，于是它的绑定把这些调用解析到系统 `libgobject`，而不是内置 `libvips-cpp.so` 自己的那份。vips 对象由内置 libvips 的 GType 系统创建，系统 GObject 看不到这些类型，于是解引用空的 class 指针，进程随之死亡。崩溃的一帧是在 sharp 绑定之下经由空函数指针调用 `g_object_unref`。构造 sharp 管线并编码都能成功，只有解码会触及该冲突。

[已归档的运行时决策](../../archived/architecture/2026-09-11-desktop-electron-node-runtime.md)选择用 Electron 的 Node 模式运行 Host，以避免重复一份 JavaScript 运行时；产物 smoke 则在 Linux 上跳过 sharp 的解码部分，而不是把图片附件解码当作可用能力。复现该崩溃表明产物中本来就带有 Host 可以改用的 Node 可执行文件，因此这个限制本可避免。

## Decision

在 Linux 上，Host 运行于 `resources/runtime/primary-runtime/dependencies/node/bin/` 中的独立 Node 可执行文件；在 macOS 和 Windows 上则运行于带 `ELECTRON_RUN_AS_NODE=1` 的 Electron。[host-runtime.ts](../../../../apps/desktop/src/host-runtime.ts) 中的 `resolveDesktopHostRuntime` 在两者之间选择，所有需要 Host 运行时的调用方都向它询问：Electron 主进程、运行时准备、开发启动、运行时 smoke 以及工作区更新资格验证。

Linux 不会向 Host 链接任何 GLib，因此打包的 libvips 绑定能解析自身符号，解码可用。Host 保留 `--expose-internals`，Cordis 加载器需要它，普通 Node 也接受它。Desktop Linux 不打包 ASAR——打包后的 Linux 资源是普通 `app` 目录——因此真正的 Node 可以原样读取该运行时树。

包操作仍使用 Host 自身的可执行文件：`process.execPath` 加 `--expose-internals` 和内置 pnpm。[node-mode.ts](../../../../apps/desktop-host/src/node-mode.ts) 中的 `packageManagerEnvironment` 仅在该可执行文件是 Electron 时加入 `ELECTRON_RUN_AS_NODE`，并始终用 `DSH_DESKTOP_NODE_EXECUTABLE` 指向它，使私有 `node` shell 启动器转发到同一运行时。`versions.json` 与 `desktop-runtime.json` 的 `node` 字段记录执行 Host 的 Node：Electron 的 Node 版本，Linux 上则是内置 Node 的版本。产物 smoke 会断言该字段，从而为打包应用钉住运行时选择。

产物 smoke 在各平台都会执行 sharp 的编码与解码，包管理器 smoke 通过 shell 生命周期脚本安装并断言其运行所处的运行时，准备产物 smoke 则在 Host 的可执行文件下运行这两者。Linux 可以验证打包应用中的图片附件解码，因为打包树与准备树是同一个普通目录。

## Alternatives considered

**保留 Electron，把图片解码移入子进程。** Host 继续运行在 Electron 上，每次解码都要跨进程边界。这会在每个图片附件的热路径上引入一套自带启动、取消、超时与错误映射的协议，而且其他所有原生依赖仍与 Electron 的 GLib 共享同一符号命名空间。

**所有平台都用内置 Node 运行 Host。** 单一运行时会安装插件、加载插件并运行插件，原生模块永远不会在两个运行时之间迁移。代价是放弃 macOS 与 Windows 上的 ASAR，或者把整个 `dsh` 树解包，然后重新验证签名、完整性与文件清单。这是为修复一个平台只需选择它已经携带的可执行文件即可解决的缺陷，而对所有发布目标做出的打包改动。

**针对 Electron 的头文件重新编译原生绑定。** 冲突发生在两份 GLib 之间，而不是两个 Node ABI 之间；重新编译绑定并不会把 Electron 泄漏的符号移出进程。它还会把原生工具链引入发布路径，并放弃 sharp 的预编译二进制。

**依赖 `LD_PRELOAD` 或 `LD_LIBRARY_PATH` 的绕行方案。** libvips 能否满足自身的 GLib 符号取决于动态链接器的加载顺序，而这随版本与发行版而变；而且向 Electron 进程预加载一份 GLib 改变的是整个应用的运行时，而非 Host 的运行时。

## Consequences

Linux 会运行两个 Node 版本：壳层用 Electron 的 Node，Host 及其插件用内置 Node。`desktop-runtime.json` 的 `node` 字段不再总是等于壳层进程的 `process.versions.node`，因此任何推导 Host 运行时事实的地方都必须读该字段，而不是读 Electron 进程自身的版本。

Host 的运行时是构建输入而非固定选择，因此打包与开发必须先准备 primary runtime，之后才能解析 Host、执行 smoke 或记录发布描述符。运行时准备因此先下载 primary runtime，再写入 `versions.json`；工作区更新资格验证先准备它，再写入开发项目元数据。

原生插件模块在 Host 中由安装它的运行时加载，也就是内置 Node，因此对这条路径而言，加载方与被加载进程之间的 ABI 不匹配已不再可能。不再设置 `ELECTRON_RUN_AS_NODE` 也意味着不再向原生包在加载期执行的 `node-gyp-build` 解析谎称 Electron 运行时，从而为真正加载它的 ABI 选择预编译产物。Linux 上 Host 行为不再依赖 Electron 自身的 Node 补丁，因此未来升级 Electron 不会使其回退。macOS 与 Windows 保持 Electron 的 Node 模式及其单一运行时。

此前在产物 smoke 中跳过 sharp 解码部分的决定已撤销：smoke 在各平台都会解码。它所记录的、关于打包 Linux 应用图片附件解码的限制已不复存在。

## Related

- [已归档：使用 Electron 作为 Desktop 的 Node 运行时](../../archived/architecture/2026-09-11-desktop-electron-node-runtime.md)
- [Desktop 参考：本地 Linux 构建](../../../../apps/desktop/README.zh.md#local-linux-appimage-without-release-signing)
