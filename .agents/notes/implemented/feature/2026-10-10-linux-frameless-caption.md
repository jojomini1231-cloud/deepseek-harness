# Agent Note: One desktop caption across Windows and Linux

Status: implemented

English | [中文](2026-10-10-linux-frameless-caption.zh.md)

## Problem

The desktop window carried a caption band only on Windows. `createWindow()` matched `win32` for `titleBarStyle: 'hidden'` plus a window-controls overlay and `darwin` for `hiddenInset`; Linux matched neither, so Electron fell back to its GTK client-side decoration. That decoration renders as a heavy band above the application with a title, native window buttons, and an Application/Edit menu row whose labels come from the shell locale rather than the document.

The band duplicated chrome the application already draws. The client reserves a caption band at the top of `AppFrame`, the sidebar pins its toggle and New Session controls inside it, and the Windows preload mounts its menu entries there, so Linux was rendering two captions stacked.

## Decision

The caption band is a desktop surface, not a Windows one. The client marker, its height custom property, and the desktop layout constant are named for the desktop (`data-desktop-caption`, `--dsh-desktop-caption-height`, `DESKTOP_CAPTION_HEIGHT` in `apps/desktop/src/desktop-layout.ts`), and `preload-caption.ts` installs it on both `win32` and `linux`.

Linux gets the same frameless treatment as Windows through `titleBarStyle: 'hidden'`, which clears `has_frame_` while preserving the window shadow that `frame: false` would drop. GTK offers no window-controls overlay, so the shell draws its own minimize, maximize/restore, and close controls in `preload-caption-controls.ts` over the band's drag surface. Each control invokes `dsh-desktop:window-control` with a validated command; the main process checks the sender and frame, then minimizes, toggles maximize, or quits. `dsh-desktop:window-maximized` carries the window state back after each change and after every page load, so the drawn glyph and its label follow a maximize the user triggers another way, such as a double-click or a window manager shortcut.

Linux installs no application menu at all: `refreshApplicationMenu()` calls `Menu.setApplicationMenu(null)`. With no menu there is no accelerator for the devtools, so development keeps F12 as a direct key handler.

Closing the Linux window quits rather than hides. Linux ships no tray, so a hidden window would have no way back; the drawn close control and the window's own close both go through `app.quit()` and therefore through the same task-interruption confirmation as every other quit entry.

The caption stays visible in native fullscreen on Linux. Fullscreen state is not relayed, so a frameless fullscreen window keeps a visible way out.

The welcome window takes the same frameless option. It is fixed size and not resizable, so it needs only a close: `welcome-window.ts` loses its GTK decoration, the welcome document's existing title strip keeps the drag surface, and `WelcomePage.tsx` draws a close control there from the preload's `drawsCloseControl` flag, using the shared library's close glyph. The control closes the window over `dsh-welcome:close-window`, and the window's existing closed handler decides whether that quits the application or leaves the workspace running.

## Alternatives considered

**Build a separate Linux caption beside the Windows one.** It would duplicate the drag band, the clearance variables, and the overlay seat timing, and the two would drift. Generalizing the marker gave Linux the existing sidebar, panel, and dialog clearance for free.

**`frame: false` instead of `titleBarStyle: 'hidden'`.** `frame: false` also clears the window shadow, so the frameless window would lose its edge against the desktop. Source inspection of Electron confirmed `titleBarStyle: 'hidden'` drops `has_frame_` on every platform while leaving the shadow to the resize path.

**Keep the GTK decoration and only remove the menu.** The band is drawn by Electron, not by the application; nothing in the application can retitle or restyle its controls, and the user's complaint was the band itself.

**Extend `data-fullscreen` to Linux for parity with Windows and macOS.** A frameless fullscreen window with a hidden caption would have no visible exit affordance. Leaving the caption up costs a band of vertical space in fullscreen and keeps the escape route.

**Reuse the shared icon library for the control glyphs.** The library ships no minimize or maximize/restore glyph, and a preload cannot render a React component. `caption-glyphs.ts` holds four SVG paths in the desktop package, following the existing desktop-owned SVG precedent. The welcome control is different: it renders in the React welcome document, which already depends on the shared primitives, so it uses the library's own close glyph rather than a desktop-owned path.

## Consequences

Sidebar, panel, dialog, and dockkit clearance, the drag band, and the overlay seat timing are shared across both caption platforms; only the controls differ, and only on the platform that must draw them. The `ui-theme` app-region gate still sees exactly two `drag` declarations, because the controls host lives in `apps/desktop` and declares only `no-drag`.

Linux loses menu accelerators for editing commands. Cut, copy, and paste still work through the editor's own key handling and its context menu, and plugin management had already moved to the application's Plugins page. Development keeps the devtools on F12, and `DSH_DESKTOP_OPEN_DEVTOOLS` still opens them at startup.

The drawn controls are desktop-only copy: five new keys in `apps/desktop/src/locale.ts` cover the group label and the four button labels, and the controls follow the document language directly, since Linux has no palette probe to drive their refresh. The close control's hover uses the existing danger tokens rather than introducing a red of its own.

A hidden window is not recoverable on Linux at all, so minimize is the only way to get the window out of the way without ending the session.

The welcome window keeps its own narrow title strip and its own close control rather than hosting the workspace caption: it loads the isolated welcome preload, not the application preload, and shares none of the caption marker, clearance variables, or overlay seat. The strip gains a layout role on Linux and drops its `aria-hidden`, since it now contains the only way to close the window before the workspace opens.

The workspace caption was verified on a real Linux session: the window reports zero decoration, the drawn controls minimize, toggle maximize with a matching glyph swap, and quit through the confirmation, and the close control's hover takes the same danger tokens the workspace caption uses. The welcome window was verified the same way.

## Related

The [archived Windows caption note](../../archived/feature/2026-09-16-windows-desktop-titlebar.md) records why Windows took the native-overlay route and why custom HTML controls lost there; Linux has no overlay to reuse, so this note reverses that alternative for Linux only.

## Testing

Desktop startup tests assert the frameless Linux window options, the empty application menu, sender rejection and command validation on the window-control channel, the maximize relay after each change and page load, and that closing the Linux window quits instead of hiding. Preload tests cover platform isolation, the absence of a palette probe on Linux, and the drawn controls' mount timing, labels, language following, glyph swap, disposal, and rejected-command reporting. Welcome tests assert the frameless Linux window options, sender rejection on the close channel, and that the drawn close control appears only where the platform supplies no window controls. Windows and macOS behavior is unchanged and pinned by the same files.
