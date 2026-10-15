---
description: "Host owner of the browser-device roster: records every launch-token exchange, lists the browsers that reached this deployment, and revokes one on demand."
kind: "package-reference"
---

# Device Controller

English | [中文](README.zh.md)

## Summary

`@deepseek-ai/dsh-api-device-controller` exposes the generated `ctx.remote.devices` namespace and implements the `BrowserDeviceStore` extension point `dsh-client-connection` authenticates browsers against. It records the browser behind every launch-token exchange, answers whether a device may still authenticate, and serves the Settings device page's list, rename, and revoke operations. Records live in the `browser_devices` storage domain outside Session data, so a revoked browser stays revoked across a Host restart.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this package as a Loader entry in a profile that composes the Connection browser carrier. It requires `connection` and `storageDomain`, and the entry belongs to the Web application bundle: a deployment without the carrier never activates it, and one without a browser-facing listener has nothing to record.

Authentication answers from an in-memory index, so `admits` and `touch` never touch the medium. `touch` moves the live `lastSeenAt` on every admitted request and persists it at most once a minute; the roster is read synchronously because a request cannot wait for storage. Once the durable roster has loaded, it is authoritative: a device it does not hold was revoked. Before that, `admits` answers true only inside the configured `rosterLoadGraceMs` after the store attaches — ten seconds by default — because refusing a device the roster has simply not read would lock every browser out of a deployment that just restarted; a device this process itself enrolled stays admitted throughout. An open that rejects, or a load still unread past that window, admits nothing: an unanswerable revocation question must not become an admission, so a Host restarted after a revocation cannot readmit the revoked browser.

`list()` returns every recorded device, most recently active first, carrying the user agent and peer address the exchange observed. `rename(id, name)` sets a label of at most 64 UTF-8 bytes, and a blank or whitespace-only value clears it so the row falls back to the name derived from its own user agent. `revoke(id)` deletes the record durably before it returns, so the browser's signed cookie stops authenticating at its next request and it returns only by opening the URL printed by `dsh web` again — as a new device, because the old row is gone rather than tombstoned. A delete the medium refuses restores the record and rejects, so a revocation this method reports as failed is one a restart cannot readmit.

The roster keeps at most `maxDevices` devices, 100 by default. Enrolling past the cap retires the device whose last authenticated request is oldest and deletes its record durably, so a deployment that keeps minting identities cannot grow the durable table without bound. A retirement the medium refuses is logged and retried at the next load.

An id this deployment never recorded, or one that is empty or longer than any minted id, is `devices/unknown`. A well-formed request the roster refuses — a label over its byte limit — is `devices/rejected`. A roster that cannot open fails every method, which is the earliest point this asynchronously opened owner can resolve.

-----

<a id="model-experience"></a>
## Model Experience

None, as browser authentication and the device roster act on HTTP request admission and never enter model prompts, Session logs, or tool results.

#### KV Cache effect

No model request prefix changes.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **A revocation reaches an open WebSocket only at its next reconnect.** Admission happens at the upgrade, and API Gateway owns stream lifetime, so a stream already open keeps running until the transport reconnects or the page reloads. Closing established streams on revocation would need a Gateway-owned signal this package does not have.
- **The page cannot mark which row is the browser reading it.** The device id rides the signed cookie, which the page cannot read, so identifying the current device would mean threading it through `PeerAdmission`, the RPC handler, and Gateway dispatch. Revoking one's own browser therefore signs the operator out immediately, and the confirmation says so.
- **The page reads the roster when it opens and after each write, and no Host event pushes a change.** Two open Settings panels do not converge until one of them reads again; a `devices/changed` forwarded event would need an entry in the API Remotes allowlist.

<a id="dev-note"></a>
### Dev Note

None.
