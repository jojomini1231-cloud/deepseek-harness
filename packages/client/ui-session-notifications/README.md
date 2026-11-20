---
description: "Raise operating-system notifications for a Session awaiting input and for an unread turn outcome."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-session-notifications

English | [中文](README.zh.md)

## Summary

Raise a browser or desktop notification when a Session starts waiting for the user, and when a turn finishes with an unread result. The plugin reads the Client's Session status table, so it reports exactly the facts the workspace sidebar already shows and adds no Host state of its own.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

The Web bundle includes this plugin, and a profile lists it as the `ui-session-notifications` row. It contributes nothing to a slot and renders no element: it subscribes to `uiSession.sessionStatus` and turns status transitions into operating-system notifications.

The first status table after plugin activation is a baseline and raises nothing, so enabling the plugin never reports Sessions that were already waiting or unread. After the baseline, a Session whose pending interaction appears under a new `key` raises one notification for that wait; a Session whose completion becomes unread raises one notification reporting failure or success. A new pending interaction takes precedence over an unread completion for the same Session in one transition, and each fact raises once: repeating the same pending `key` or leaving an unread state unchanged publishes no further notification. A Session that leaves the status table drops its cursor, so a later wait or completion counts again.

Titles are the Session's current `displayTitle`, falling back to a localized `untitled`. Bodies name the fact, and the notification tag is the Session identity, so a replacement cannot stack indefinitely. Activating a notification closes it, focuses the window, and opens that Session through `uiWorkspace.openSession`.

`notifyOnlyWhenUnfocused` defaults to true and suppresses every notification while the page is visible and focused, because the workspace sidebar already shows the same state on screen. A visible but unfocused window, or a background tab, still notifies.

The plugin asks for notification permission the first time it would raise one and shows that notification once the request grants permission. Denied permission silences the plugin for the rest of the session without prompting again; an environment without the Notification constructor, such as a headless browser, silences it too.

`notifyPendingInteraction` and `notifyCompletion` switch the two classes independently, and all three fields are volatile members of the Host entry's Config, so a `cordis.yml` change reaches open pages without remounting the plugin. Notification state is memory-only: it is not stored in the browser and never enters a Session log.

<a id="model-experience"></a>
## Model Experience

None, as notifications are client presentation facts and never enter model requests or Session logs.

#### KV Cache effect

No model request prefix changes.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The plugin notifies from the Client status table only, so a Session that waits or finishes while no page is open raises nothing; a future Host-side notifier would cover closed windows.
- Completion notifications depend on the same focus rule the sidebar uses: the Session the user is reading never becomes unread, so reading a turn to its end raises no notification.
- Notifications are unsupported where the browser hides the Notification constructor; the plugin then stays silent instead of degrading to an in-page banner.

<a id="dev-note"></a>
### Dev Note

The transition rules are a pure function tested without a browser; the plugin suite scripts the status table, permission states, and focus so each branch runs in jsdom.
