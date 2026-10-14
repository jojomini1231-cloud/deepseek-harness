---
kind: upgrade-guide
description: "Desktop on Linux now hides to a tray icon on close instead of quitting, and the tray menu Quit entry becomes the explicit exit."
---

# Linux Desktop closes to the tray

English | [中文](guide.zh.md)

## Change

On Linux, closing the Desktop window used to quit the application through the ordinary task confirmation, because no tray existed to recover a hidden window. The application now keeps a tray icon for the whole run like Windows: closing the main window — its window-manager close or the drawn caption close control — hides it after a one-time acknowledgement, the Host and tasks keep running, and the tray menu's Open entry, a tray click where the panel delivers one, or a second launch bring the window back. The tray icon needs a desktop environment that shows StatusNotifierItem icons; GNOME shows it only with its AppIndicator extension, and libappindicator panels deliver no click, so use the menu there. The tray menu's Quit DeepSeek Harness entry is the explicit exit on Linux and runs the same task-confirmation check the close used to run. When the tray icon cannot be created at all, Linux keeps the old behavior: close quits through the ordinary confirmation. Windows and macOS behavior is unchanged.

## Migration

1. On GNOME, enable the AppIndicator extension (Ubuntu recent releases install and enable it by default) so the icon appears; on other desktop environments no step is needed.
2. If you rely on closing the window to quit, use the tray menu's Quit DeepSeek Harness entry instead; it asks the same interruption confirmation before stopping Host tasks.
3. Confirm the upgrade by closing the main window: after the one-time acknowledgement the window hides, the tray icon stays, and reopening from the tray restores the same document.
4. If no tray icon appears in your environment, restart the application — the second launch focuses the hidden window — and a failed tray creation makes close quit again, so the application never becomes unreachable.
