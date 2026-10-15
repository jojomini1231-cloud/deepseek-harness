---
description: "Device management settings page on the dsh web client: every browser that signed in to this deployment, with rename and revoke."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-devices

English | [中文](README.zh.md)

## Summary

The Device management page lists the browsers that have signed in to this deployment, naming each one from its user agent until the operator labels it, and offers rename and revoke. It registers into `settings.section` while the Host serves the generated `devices` namespace, so a deployment without a browser-device roster shows no trace of it.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

The section registers through `settings.section` and reads the roster over the `devices` Remote namespace. A device the operator renamed shows that label; every other row shows the browser and system the page derives from the stored user agent, worded by this package's own dictionary, beside the raw agent string that identifies an unnamed browser. First-seen and last-active times use the shared relative-time buckets, so two surfaces dating the same moment agree.

Revoking confirms first and states the consequence plainly, because the device id rides the cookie the page cannot read: the operator cannot be told which row is their own browser, so revoking it signs them out immediately. The controls carry the error tint, and each row's own buttons name the device they act on. Nothing is revoked until the confirmation is accepted, and a refusal from the Host appears on the page rather than failing silently; an accepted write clears the previous refusal instead of leaving it standing.

The page reads once when it opens and once after each acknowledged write, then shows what the Host reported; the rows follow that answer rather than a local guess at what a write changed. A browser that revoked its own device can no longer read the roster, so the page names that outcome and withholds a retry that could not succeed. Relative dates are re-read on a timer, and the first read shows placeholder rows rather than an empty roster.

-----

<a id="model-experience"></a>
## Model Experience

None, as the device page presents HTTP authentication facts to the operator without contributing model context or Session events.

#### KV Cache effect

No model request prefix changes.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **The page cannot mark the browser reading it.** The device id rides the signed cookie, which no script on the origin can read — that is what keeps the identity unforgeable — so there is no client-side way to identify the current row. Doing so needs the fact to cross from admission into the RPC handler, which belongs to the Connection and Gateway layers.
- **Two open Settings panels do not converge on their own.** The roster is read on open and after each write, and no Host event pushes a change to other clients; adding one needs a `devices/changed` entry in the API Remotes forwarded-event allowlist.
- **An open stream outlives a revocation.** The Host refuses the device at its next request, including the WebSocket upgrade, but a stream already open keeps running until that transport reconnects or the page reloads.

<a id="dev-note"></a>
### Dev Note

None.
