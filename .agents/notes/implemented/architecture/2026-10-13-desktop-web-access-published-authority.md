# Agent Note: Desktop Web access published under one external authority

Status: implemented

English | [中文](2026-10-13-desktop-web-access-published-authority.zh.md)

## Problem

[Desktop Web access](2026-10-13-desktop-web-access-loopback-port.md) gives this machine's browsers a way into the running application, and it deliberately binds loopback only. An operator who wants to reach that listener from another device — the common case being a tunnel or reverse proxy forwarding to `127.0.0.1:3080` — opens the browser-facing hostname and receives `dsh web authentication required; reopen the URL printed by dsh web.`

Two independent checks produce it, and neither is a bug in the fence or in authentication:

`isTrustedApiRequest` (`packages/client/connection/src/api-request-trust.ts`) admits loopback, the listener's own bind address, and authorities named in `trustedHosts`. A tunnel hostname is none of them, so every `/api` call answers `403 forbidden`. The index request carries no fence at all: it goes straight to `BrowserAuth.authorizeIndex` and answers a plain `401` authentication page.

`BrowserAuth` mints a host-only session cookie whose name and payload are bound to the authority that minted it (`packages/client/connection/src/browser-auth.ts`). A cookie obtained at `127.0.0.1:3080` is neither sent to the tunnel hostname nor accepted there, and the launch-token exchange only answers at one path: a `GET` of `/` carrying the token, which redirects to `./`. A browser that reaches the deployment under the public authority must therefore repeat that exchange there, which requires the operator to hold a URL carrying this process's launch token.

The Web profile already has a flag for each half — `--trusted-host` admits an authority, `--public-url` advertises a root — but the desktop shell supplied neither, and the Host child reports only its loopback URL, so the shell had no way to reach those flags and no way to hand out an authenticating link.

## Decision

Settings → General → **Browser access** gains one optional **Trusted domain** field, stored as `web.trustedHost` in `userData/desktop/settings.json`. It accepts a bare `host[:port]` or an absolute `http(s)://` URL whose path is the mount prefix a proxy strips. Electron derives both Web-profile flags from that single value in `webAccessBindArgs` (`apps/desktop/src/web-access.ts`) and appends them to the Host child's argv only while the setting is on, so an unpublished listener binds byte-for-byte what it bound before.

One value, not two. The flags are not interchangeable — the fence accepts the authority, and the advertised root is what the browser opens and what the launch-token exchange must land on — so exposing them separately would let an operator configure a deployment where the fence admits an authority the browser never uses, or advertises a root the fence refuses. Deriving both from one authority makes the half-configured state unrepresentable, at the cost of not supporting an advertised root whose fence authority differs (a proxy that rewrites `Host`).

The field is validated three times, each layer owning what it can enforce. The settings row checks shape so a draft fails immediately; `webAccessSection` validates a stored value at read time and reports it through the document-level fallback; and `parseWebAccessEndpoint` is what the write handler calls, so the reason reaches the user. The Host remains the authority on what the fence accepts, and still rejects an authority it cannot parse when `client-connection` loads `trustedHosts`. The authority is normalized to the URL host, which is what a browser sends in `Host`: a scheme-default port and a redundant trailing slash are the only rewrites accepted, and a value WHATWG would otherwise rewrite fails loudly rather than becoming an authority the fence never matches.

The launch token still never crosses to the renderer. `status()` reports the published root as `publicAddress`, with no token, and a new `copyLink()` handler builds `<publicRoot>?token=<token>` and writes it to the system clipboard inside the main process, returning nothing.

## Alternatives considered

**Two fields, `trustedHost` and `publicUrl`.** More expressive and closer to the flags, but it makes the half-configured states above representable and asks the operator to keep two values consistent by hand. A deployment needing a different fence authority from its advertised root has no reason to arise from the desktop shell's own listener.

**Reuse `open()` for the published address instead of adding a copy action.** Opening the loopback URL is what the button already does, and opening the *public* URL on this machine would authenticate against the tunnel rather than the listener, which is rarely what the operator wants. More decisively, the value to move is the token-bearing URL itself: the operator needs it on a different device, and a link on the clipboard is what carries it there.

**Bind the LAN interface instead of naming an authority.** The [loopback decision](2026-10-13-desktop-web-access-loopback-port.md) already refused this. It would expose the port to the whole network rather than to one named authority, and no configuration of the fence makes the listener itself less reachable.

**Have the Host child report the public URL so Electron can derive the link from it.** `apps/desktop-host/src/index.ts` builds its ready URL from a hardcoded loopback address, and changing that would make the desktop window's own origin, cookie, and boot injections depend on the advertised root — the exact coupling the loopback decision avoided. The shell derives the published link instead, and the token is the same process credential either way.

## Consequences

Enabling the domain admits that authority to the fence for the whole listener, so every request the tunnel forwards is trusted as far as the fence is concerned; authentication still decides, and a browser without a cookie or token is refused. The copied link is a live credential: it carries the launch token in its query string, and unlike a URL handed straight to the browser it rests on the system clipboard, where a clipboard manager or an operating-system clipboard sync can retain it. The [Desktop reference](../../../../apps/desktop/README.md#web-access-for-this-machine-s-browsers) states both facts.

A non-loopback trusted authority flips `connection.allowsRemoteAuthorities`, which makes `directory-picker-auto` mount the in-browser chooser instead of the native OS dialog. This is not fixable by pinning the native backend: one Host serves both clients, and a remote browser cannot see a chooser on this machine. The desktop window therefore browses directories while the domain is configured, which the same reference documents.

The field is a shell-owned startup preference like the port, so it takes effect at the next launch and the row reports `restartRequired` until then; a stored value must be valid at read time, because it is spent while building the child's argv, where a throw would abort startup rather than fall back to defaults.
