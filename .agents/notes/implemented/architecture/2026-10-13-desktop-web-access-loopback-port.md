# Agent Note: Desktop Web access on a chosen loopback port

Status: implemented

English | [中文](2026-10-13-desktop-web-access-loopback-port.zh.md)

## Problem

The desktop application runs the complete Web Host as a child process, but it starts that child with `--port 0`, so the listener takes an OS-assigned port that nothing outside the application knows. Electron dials that port through its own `dsh-app://` carrier and authenticates with the Host's launch token, and no other browser can reach the running application. A person who wants to watch a session in a normal browser tab — or type into it from one — has no way in.

Everything else needed is already in place: `session/follow` opens one live stream per viewer, so several clients can watch one session's execution trace, and `session/prompt` takes the per-session writer lock, so a browser can submit prompts into the session the desktop window is running. The request trust fence already admits loopback authorities. The missing piece is only a bind port the user chooses and knows.

## Decision

Settings → General → **Browser access** stores `web: { enabled, port, trustedHost }` in `userData/desktop/settings.json`, the shell configuration document Electron owns independently of the Host. The listener stays on loopback and this note owns only the port; the optional `trustedHost` publishes it under one external authority and is the [separate decision](2026-10-13-desktop-web-access-published-authority.md). Electron reads that snapshot once at `main()` and derives the Host child's bind arguments from it through `webAccessBindArgs`, so turning the toggle on, changing the port, or turning it off takes effect at the next launch; the row reports `restartRequired` while the stored choice differs from the running listener. With the setting off, the arguments are exactly what they were before (`--host 127.0.0.1 --port 0`), so the application window's own path is unchanged.

The listener binds `127.0.0.1` only. Serving other machines would put this application's remote code execution on the network, which is why the harness rejects wildcard binds outright; a setting is not the place to reopen that.

The launch token never crosses to the renderer. `status()` returns an `address` of `host:port` with no token, and `open()` spends the authenticated URL in the main process through `shell.openExternal` — the same shape as the existing update carrier, where the renderer names an action and the main process owns the authority.

The row lives in `packages/client/ui-settings-general`, the General-section owner that already hosts the Desktop update bridge, and is registered only when `globalThis.dshDesktop.webAccess` exists. An ordinary Web deployment therefore never sees it, and no new package, roster row, or i18n namespace is needed. The port bounds appear once in `apps/desktop/src/settings.ts` and once in the row's registration; `apps/desktop/tests/web-access.spec.ts` pins the two together, because the row cannot import Electron-side code.

## Alternatives considered

**Make the port live, re-binding the listener on change.** This needs a second listener capability on `packages/host/webserver` — multiple bind addresses on one route table, one auth owner, one trust fence — plus a new Host plugin on the volatile-configuration path to bind and unbind it. The Host's port is consumed by `ready.url` before any window exists, so a live change would also have to re-issue the authenticated URL, the boot injections, and the Electron cookie. A restart removes all of that, and the desktop shell's own settings document was already documented as taking effect on the next launch.

**Bind the interface the machine uses on the LAN.** Then `client-connection`'s `trustedHosts` would have to admit that authority, because the fence refuses a non-loopback Host that is not configured; the request would otherwise 403 on every API call. That widens the exposure the harness deliberately refuses to widen by default and needs its own security review and warning copy, which is a different change from giving this machine's own browsers a way in. The listener still binds loopback; that follow-up shipped as the [published-authority decision](2026-10-13-desktop-web-access-published-authority.md), which admits one operator-named authority without binding the LAN interface.

**Put the port on the Host's `webserver` entry and edit it through the Plugins settings page.** The port is resolved from command-line flags into the composed row, so a settings write would fight the launcher's own value, and the Electron shell would still have to rewrite the child's argv. The shell's settings document already owns exactly this kind of startup-only preference.

**Serve the Web dist directly rather than reusing the Host listener.** Electron already forwards to the Host, and the Host already serves the dist over its fallback seat with authentication, plugin bundles, and the API on the same origin. A second server would duplicate all of it.

## Consequences

A chosen port that is already taken — most plausibly by a `dsh --profile web` run, whose default is the same `3080` — surfaces as the existing `EADDRINUSE` startup diagnostic instead of being silently reassigned. That is deliberate: a browser bookmark that quietly moves to another port is worse than a startup failure that names the cause.

Enabling the setting widens what can reach this Host: any process on the machine that obtains the authenticated URL can drive the session, and the URL carries the token in its query string. The token remains a process credential that changes every launch, the listener stays on loopback, and the address the row renders never contains it; the [Desktop reference](../../../../apps/desktop/README.md#web-access-for-this-machine-s-browsers) states the sharing rule.

The `payload web` field is read at startup, so a hand-edited document and the Settings row behave identically: the next launch applies it. A document whose `web` section is invalid fails validation and the whole document falls back to the defaults, which is the same rule the existing `updates` field follows — one bad field does not silently keep a port the user did not choose. A `trustedHost` is validated at read time for the same reason: it is spent while building the child's argv, where a throw would abort startup instead of falling back.
