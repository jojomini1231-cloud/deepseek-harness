# Agent Note: Browser Session notifications

Status: implemented

English | [中文](2026-11-19-client-session-notifications.zh.md)

## Problem

A Session that starts waiting for the user, or that finishes while the reader is somewhere else, was visible only inside the page: the sidebar row changed status, and nothing reached the operating system. A user working in another application learned about the wait or the failure only after switching back.

The facts already exist on the Client. `ctx.uiSession.sessionStatus` publishes running state, the effective pending interaction, and reading reminders for every Session, and the Host Remote service keeps the reminders across reconnects.

## Decision

A Client plugin, `@deepseek-ai/dsh-client-ui-session-notifications`, turns status transitions into browser or operating-system notifications. It owns no Host state and renders no element.

### Transition rules

| Rule | Rationale |
|---|---|
| The first table after activation is a baseline | Enabling the plugin must not report the Sessions that were already waiting when the page opened; those are the sidebar's state, not new events |
| A pending interaction raises when its `key` changes | The key identifies the interaction, so an interaction replaced by a different one while the page was focused still notifies |
| A completion raises when `completionUnread` turns true | Reading reminders already decide whether a finished turn is worth reporting; the plugin never duplicates that judgement |
| A pending interaction wins over a completion in one snapshot | The Session now waits on the user, so that fact matters more than the turn that just ended |
| A Session leaving the table drops its cursor | A deleted or filtered-out Session must not suppress a later wait under the same identity |

### Suppression

The page suppresses notifications while its window is visible and focused, because the sidebar already shows the same status on screen. A visible but unfocused window and a background tab still notify. `notifyPendingInteraction`, `notifyCompletion`, and `notifyOnlyWhenUnfocused` are volatile Host `Config` fields, so a `cordis.yml` change reaches open pages without remounting the plugin.

### Permission

The plugin requests notification permission the first time it would raise one and shows that notification once the request grants permission; notifications raised later while the prompt is still open are dropped, so a permission prompt never interrupts a turn start and never queues stale facts. Denied permission silences the plugin for the rest of the page; an environment without the `Notification` constructor stays silent rather than degrading to an in-page banner, which the sidebar already provides.

## Alternatives considered

| Option | Why it was rejected |
|---|---|
| A `Notification` hook event in `packages/experimental/hooks-claude-code` | The hook protocol runs one shell command per Session event on the Host and exposes no way to open the Session the notification names; it also covers turn end only, not a pending interaction |
| A Desktop-only Electron notification in `apps/desktop/src` | The Desktop renderer exposes the browser `Notification` API through Chromium already, so an Electron-side implementation would duplicate every decision and leave the Web client silent |

## Consequences

- The plugin notifies only from the Client status table, so a Host running without an open page raises nothing. A future Host-side notifier would extend this decision rather than replace it.
- Notifications follow the sidebar's focus rule: the Session a user is reading never becomes unread, so reading a turn to its end produces no notification.
- The transition rules are a pure function over projected status facts, tested without a browser; the plugin suite scripts the table, permission states, and focus.
