# Agent Note: Run the Desktop Host on the bundled Node on Linux

Status: implemented

English | [中文](2026-10-12-desktop-linux-host-node.zh.md)

## Problem

Reading an image attachment ends the packaged Linux application. The Host process exits on SIGSEGV the first time sharp decodes a raster, and the shell reports only `dsh desktop host stopped` beside sharp's load-time warning about Electron's Linux binaries.

The fault is a GObject type-system clash. Electron's Linux binaries link the system GLib and resolve their own undefined GLib symbols from it, so the system `libgobject` occupies the process-global symbol namespace. The packaged `sharp-linux-x64.node` leaves `g_object_unref` and its neighbours undefined, so its bindings resolve those calls to the system `libgobject` rather than to the copy inside the bundled `libvips-cpp.so`. Vips objects are built by the bundled libvips GType system; the system GObject cannot see those types, so it dereferences a null class pointer and the process dies. A frame of the failure is `g_object_unref` called through a null function pointer, under the sharp binding. Constructing a sharp pipeline and encoding succeed; only decoding reaches the clash.

The [archived runtime decision](../../archived/architecture/2026-09-11-desktop-electron-node-runtime.md) chose Electron's Node mode for the Host to avoid duplicating a JavaScript runtime, and the payload smoke skipped sharp's decode half on Linux rather than treat image attachment decoding as usable. Reproducing the crash shows the payload already carries a Node executable the Host can use instead, so the limitation was avoidable.

## Decision

The Host runs on the standalone Node executable in `resources/runtime/primary-runtime/dependencies/node/bin/` on Linux, and on Electron with `ELECTRON_RUN_AS_NODE=1` on macOS and Windows. `resolveDesktopHostRuntime` in [host-runtime.ts](../../../../apps/desktop/src/host-runtime.ts) selects between them, and every caller that needs the Host's runtime asks it: Electron main, runtime preparation, development, the runtime smokes and the workspace-update qualification.

Linux links no GLib into the Host, so the packaged libvips bindings resolve their own symbols and decoding works. The Host keeps `--expose-internals`, which the Cordis loader needs and which plain Node also accepts. Desktop Linux ships without ASAR — packaged Linux resources are a plain `app` directory — so a real Node can read the runtime tree unchanged.

Package operations stay on the Host's own executable: `process.execPath` with `--expose-internals` and the bundled pnpm. `packageManagerEnvironment` in [node-mode.ts](../../../../apps/desktop-host/src/node-mode.ts) adds `ELECTRON_RUN_AS_NODE` only when that executable is Electron, and `DSH_DESKTOP_NODE_EXECUTABLE` always names it so the private `node` shell launcher forwards to the same runtime. The `versions.json` and `desktop-runtime.json` `node` field records the Node that executes the Host: Electron's Node version, or the bundled Node's on Linux. The payload smoke asserts it, which pins the runtime choice for the packaged application.

The payload smoke exercises sharp's encode and decode on every platform, the package-manager smoke installs through a shell lifecycle script that asserts the runtime it ran under, and the prepared-runtime smoke runs both under the Host's executable. Linux can verify image attachment decoding in the packaged application because the packaged and prepared trees are the same plain directory.

## Alternatives considered

**Keep Electron and move image decoding into a child process.** The Host would stay on Electron and each decode would cross a process boundary. This adds a protocol with its own startup, cancellation, timeout, and error mapping to the hot path of every image attachment, and it leaves every other native dependency sharing the symbol namespace with Electron's GLib.

**Run the Host on the bundled Node on every platform.** One runtime would install plugins, load them, and run them, so a native module would never move between two runtimes. It requires giving up ASAR on macOS and Windows, or unpacking the whole `dsh` tree, and then revalidating signing, integrity, and the file inventory. That is a packaging change across every release target for a defect one platform can fix by selecting an executable it already ships.

**Rebuild the native bindings against Electron's headers.** The clash is between two copies of GLib, not between two Node ABIs; rebuilding the bindings does not remove Electron's leaked symbols from the process. It would also put a native toolchain in the release path and give up sharp's prebuilt binaries.

**Rely on `LD_PRELOAD` or an `LD_LIBRARY_PATH` shim.** Whether libvips can satisfy its own GLib symbols depends on the dynamic linker's load order, which is version- and distribution-dependent, and preloading a GLib into an Electron process changes the runtime of the whole application rather than of the Host.

## Consequences

Linux runs two Node versions: Electron's for the shell, and the bundled Node for the Host and its plugins. The `desktop-runtime.json` `node` field no longer always equals `process.versions.node` of the shell, so anything deriving the Host's runtime facts must read that field instead of the Electron process's own versions.

The Host's runtime is a build input rather than a fixed choice, so packaging and development must prepare the primary runtime before they can resolve the Host, smoke, or record the release descriptor. Runtime preparation therefore downloads the primary runtime before it writes `versions.json`, and the workspace-update qualification prepares it before it writes the development project metadata.

Native plugin modules load in the Host on the runtime that installed them, which is the bundled Node, so an ABI mismatch between the loader and the loaded process is no longer possible for this path. Dropping `ELECTRON_RUN_AS_NODE` also stops advertising an Electron runtime to the `node-gyp-build` resolution that native packages perform at load time, so a prebuild is selected for the ABI actually loading it. Electron's own Node patches are no longer load-bearing for Host behavior on Linux, so a future Electron upgrade cannot regress it. macOS and Windows keep Electron's Node mode and its single runtime.

The earlier decision to skip sharp's decode half in the payload smoke is withdrawn: the smoke decodes on every platform. The image attachment limitation it recorded for packaged Linux applications no longer exists.

## Related

- [Archived: Use Electron as the Desktop Node runtime](../../archived/architecture/2026-09-11-desktop-electron-node-runtime.md)
- [Desktop reference: local Linux builds](../../../../apps/desktop/README.md#local-linux-appimage-without-release-signing)
