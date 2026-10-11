# Agent Note: Windows 与 Linux 共用一条桌面端顶栏

Status: implemented

[English](2026-10-10-linux-frameless-caption.md) | 中文

## Problem

桌面窗口此前只在 Windows 上有顶栏。`createWindow()` 为 `win32` 匹配 `titleBarStyle: 'hidden'` 加窗口控件覆盖层，为 `darwin` 匹配 `hiddenInset`；Linux 两个分支都不匹配，因此 Electron 退回自己的 GTK client-side decoration。这条 decoration 渲染为应用上方一条厚重的横条，带标题、原生窗口按钮，以及一行「应用」「Edit」菜单——标签取自壳语言而非文档语言。

这条横条与应用已经绘制的 chrome 重复。客户端在 `AppFrame` 顶部预留了顶栏，sidebar 把开关与新建会话控件钉在其中，Windows preload 也在这里挂载菜单入口，因此 Linux 实际叠了两条顶栏。

## Decision

顶栏是桌面端表面，不是 Windows 专有表面。客户端标记、其高度自定义属性与桌面布局常量都以 desktop 命名（`data-desktop-caption`、`--dsh-desktop-caption-height`、`apps/desktop/src/desktop-layout.ts` 的 `DESKTOP_CAPTION_HEIGHT`），`preload-caption.ts` 在 `win32` 与 `linux` 上都安装它。

Linux 通过与 Windows 相同的 `titleBarStyle: 'hidden'` 获得无边框窗口：它会清除 `has_frame_`，同时保留 `frame: false` 会一并丢弃的窗口阴影。GTK 不提供窗口控件覆盖层，因此壳在 `preload-caption-controls.ts` 中于顶栏拖拽面上自绘最小化、最大化/还原与关闭三个控件。每个控件以校验过的命令调用 `dsh-desktop:window-control`；主进程校验发送方与 frame 后，执行最小化、切换最大化或退出。`dsh-desktop:window-maximized` 在每次状态变化与每次页面加载后回推窗口状态，因此自绘字形及其标签能跟上用户通过其他途径（例如双击或窗口管理器快捷键）触发的最大化。

Linux 完全不安装应用菜单：`refreshApplicationMenu()` 调用 `Menu.setApplicationMenu(null)`。没有菜单也就没有开发者工具的加速键，因此开发模式下保留 F12 作为直接按键处理。

关闭 Linux 窗口是退出而非隐藏。Linux 不提供托盘，隐藏的窗口将无路可回；自绘关闭控件与窗口自身的关闭都走 `app.quit()`，因而与其他所有退出入口一样，经过同一个任务中断确认。

Linux 上顶栏在原生全屏下保持可见。全屏状态不做同步，无边框全屏窗口因此保留可见的退出入口。

欢迎窗口采用同样的无边框选项。它固定尺寸、不可缩放，因此只需要一个关闭入口：`welcome-window.ts` 去掉 GTK decoration，欢迎文档原有的标题条继续承担拖拽面，`WelcomePage.tsx` 依据 preload 的 `drawsCloseControl` 标记在其中自绘关闭按钮，并复用共享图标库的关闭字形。该按钮通过 `dsh-welcome:close-window` 关闭窗口，由窗口已有的 closed 处理决定这是退出应用还是保留工作区继续运行。

## Alternatives considered

**在 Windows 顶栏之外另建一套 Linux 顶栏。** 这会重复拖拽带、避让变量和 overlay 席位时序，且两者会逐渐分叉。泛化标记让 Linux 直接继承已有的 sidebar、面板与弹窗避让。

**用 `frame: false` 代替 `titleBarStyle: 'hidden'`。** `frame: false` 会一并清除窗口阴影，无边框窗口将失去与桌面的边界。查阅 Electron 源码确认 `titleBarStyle: 'hidden'` 在所有平台都清除 `has_frame_`，而阴影交由缩放路径保留。

**保留 GTK decoration，只去掉菜单。** 这条横条由 Electron 绘制而非应用绘制；应用无法重命名或重设其控件样式，而用户的诉求正是这条横条本身。

**为了让 Linux 与 Windows/macOS 一致，把 `data-fullscreen` 扩展到 Linux。** 无边框全屏窗口若隐藏顶栏，将没有任何可见的退出入口。保留顶栏要付出全屏下一带纵向空间，换来的是退出路径。

**复用共享图标库绘制控件字形。** 该库不提供最小化与最大化/还原字形，而 preload 无法渲染 React 组件。`caption-glyphs.ts` 在 desktop 包内保存四段 SVG path，沿用已有的 desktop 自持 SVG 先例。欢迎窗口的按钮不同：它渲染在已经依赖共享 primitives 的 React 欢迎文档里，因此直接用该库自带的关闭字形，不使用 desktop 自持 path。

## Consequences

sidebar、面板、弹窗与 dockkit 的避让、拖拽带和 overlay 席位时序由两个顶栏平台共享；只有控件本身不同，且只在必须自绘控件的平台上不同。`ui-theme` 的 app-region 门禁仍然只看到两处 `drag` 声明，因为控件 host 位于 `apps/desktop`，且只声明 `no-drag`。

Linux 失去编辑类命令的菜单加速键。剪切、复制与粘贴仍可通过编辑器自身的按键处理与右键菜单完成，插件管理此前也已移到应用的「插件」页面。开发模式保留 F12 开发者工具，`DSH_DESKTOP_OPEN_DEVTOOLS` 仍会在启动时打开它。

自绘控件是 desktop 专属文案：`apps/desktop/src/locale.ts` 新增五个 key，覆盖分组标签与四个按钮标签；控件直接跟随文档语言，因为 Linux 没有驱动其刷新的调色板探针。关闭控件的 hover 使用已有的危险色 token，而不引入自己的红色。

Linux 上隐藏的窗口完全无法找回，因此最小化是唯一能让窗口让位而不结束会话的方式。

欢迎窗口保留自己的窄标题条与自己的关闭按钮，而不是托管工作区顶栏：它加载的是隔离的欢迎 preload，不是应用 preload，也不共享顶栏标记、避让变量或 overlay 席位。该标题条在 Linux 上获得布局职责，并去掉 `aria-hidden`，因为在工作区打开之前，它装着关闭窗口的唯一入口。

工作区顶栏已在真实 Linux 会话上验证：窗口报告的装饰高度为 0，自绘控件可最小化、可切换最大化并同步字形、经确认流程退出，关闭按钮的 hover 使用与工作区顶栏相同的危险色 token。欢迎窗口以同样方式验证。

## Related

[已归档的 Windows 顶栏 Agent Note](../../archived/feature/2026-09-16-windows-desktop-titlebar.md) 记录了 Windows 为何选择原生覆盖层、自绘 HTML 控件又为何在那里落选；Linux 没有可复用的覆盖层，因此本记录仅在 Linux 上推翻了那个备选项。

## Testing

Desktop 启动测试断言 Linux 的无边框窗口选项、空应用菜单、window-control 通道的发送方拒绝与命令校验、每次状态变化与页面加载后的最大化回推，以及关闭 Linux 窗口时退出而非隐藏。preload 测试覆盖平台隔离、Linux 上没有调色板探针，以及自绘控件的挂载时序、标签、语言跟随、字形切换、销毁与拒绝命令上报。欢迎窗口测试断言 Linux 的无边框窗口选项、关闭通道的发送方拒绝，以及自绘关闭按钮只在平台不提供窗口控件时出现。Windows 与 macOS 行为未变，并由同一批文件固定。
