---
kind: upgrade-guide
description: "The HostConnectionHandle contract gains a required attachBrowserDevices member, and the Web profile gains a devices Remote namespace with a Settings page."
---

# Browser-device roster

English | [中文](guide.zh.md)

## Change

Web deployments that compose the Connection browser carrier now record every browser that exchanged the launch token. A new Host package, `@deepseek-ai/dsh-api-device-controller`, keeps the roster in the `browser_devices` storage domain outside Session data, so a revocation survives a Host restart, and serves the `devices` Remote namespace. The signed browser cookie optionally carries the device it was enrolled for, so a cookie bound to a revoked device stops authenticating at its next request. A browser revoked while it holds an open WebSocket keeps that stream until the transport reconnects or the page reloads, because admission happens at the upgrade.

The Device management Settings page lists those browsers with rename and revoke. It registers only while the Host serves the `devices` namespace, so a deployment without the controller shows no trace of it.

## Migration

1. **`HostConnectionHandle` gains a required member.** Anything implementing the exported interface rather than casting to it must add `attachBrowserDevices(store: BrowserDeviceStore): () => Promise<void>`. Compositions that only consume `ctx.connection` need no change: Connection attaches no registry unless the `device-controller` row is loaded.
2. **Compose the controller where browsers reach the deployment.** The [`packages/bundle/web-app`](../../../../packages/bundle/web-app/cordis.patch.yml) patch already does. A profile that builds its own Web composition adds `@deepseek-ai/dsh-api-device-controller` beside `@deepseek-ai/dsh-client-connection` and `@deepseek-ai/dsh-storage-domain`; the package is inert without a browser carrier and provides no service there.
3. **Cookies minted before this change keep working.** A payload without a device id authenticates exactly as before and belongs to no row, so it cannot be revoked by device; only a browser that exchanges the launch token again gains a revocable identity.
4. **A Host started after a revocation no longer admits the revoked browser.** The roster is authoritative once read; before that, an unread roster admits devices for at most `rosterLoadGraceMs` after the store attaches — ten seconds unless the entry sets it — and never after an open that failed. Expect a brief window in which a browser revoked by an earlier process still authenticates, followed by refusal.
5. **The roster is bounded by `maxDevices` (100 by default).** Enrolling past the cap retires the device whose last authenticated request is oldest and deletes its record, so a deployment that keeps enrolling browsers drops the idlest ones instead of growing the durable table without bound. Raise `maxDevices` in the `device-controller` entry when more than a hundred browsers must stay revocable at once; a retired browser re-enrolls as a new device and is admitted again.
6. **Device labels are bounded in UTF-8 bytes.** `rename` accepts at most 64 bytes, so a label of astral or combining characters is held to the same stored size as one of ASCII. A longer label is `devices/rejected`.
7. Confirm the entry loads with no activation error, Settings shows a Devices page, and revoking a browser there signs it out on its next request.
