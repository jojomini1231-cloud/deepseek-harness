# Agent Note: Background Sessions answer approvals from the sidebar and a frame queue

Status: implemented

English | [中文](2026-11-19-sidebar-approval-answer-surfaces.zh.md)

## Problem

An approval request belongs to the Session that raised it, so its buttons live in that Session's composer. With several Sessions open, a background Session's request is reachable only by switching to it. The sidebar already shows a pending dot, which tells the user that something waits but not what — and the decision still means leaving the Session being read.

Two surfaces are needed. One answers without navigating. The other drains a queue when the user would rather decide several at once. Neither may let an unrestricted host grant happen in one click, because a hover card is an easy place to click by accident.

## Decision

Both surfaces read `ctx.uiSession.pendingInteractions` and settle through `PendingApproval.answer`. Neither adds a Session event, a store, or a Host surface: the request's `reason` already carries the structure the compact surfaces need.

The payload is the one fact the request itself does not carry. It lives in the asking Session's `tool/call` event, but the client-side Conversation only assembles a Session that some reference retains, so reading the assembled Tool-call node works for the Session on screen and for no other. `ApprovalService` therefore folds the arguments of the calls a Session is asking about into an `approvalPayload` Session projection, which travels in the Session list row. Both surfaces read that projection, so a background Session discloses its payload without being opened, and the client assembles no Conversation history to show one command.

`approvalFacts` reduces one request to an action line, a mode, and a danger tier. For the sandbox layer the audit reason is `escalate sandbox to <mode>: <justification>`, so the justification becomes the action sentence and the mode names the permission under review. Every other asker supplies prose only, and its prompt becomes the action unchanged. `danger` is membership in a closed set that currently holds `danger-full-access`.

`ApprovalPeek` registers into `sidebar.session.row.hover`, which the Session row already mounts while its hover card is open. The row asks `HoverCard` for a wider card on an approval row, so the body can carry a title line, the action, the permission, the payload disclosure, and both decisions without wrapping the action to five lines. The body repeats the asker and its permission mode, shows the action, expands the payload the request will run, and offers reject and allow, plus a link that opens the asking Session. A danger request turns allow into a second step inside the strip: the button names the mode, the confirm row states the mode again, and only the confirm row settles. `ApprovalInbox` registers into `shell.overlay`: a count pill opens a right-edge drawer over a scrim, listing every pending approval across Sessions, with per-row decisions under the same two-step rule. Batch reject always applies. Batch allow is disabled while any row is a danger request, so the batch path cannot grant what a single row would ask twice.

Both surfaces derive their second-step state from the pending snapshot instead of synchronizing it: `confirming` is computed from the armed key and the current rows, so a row that disappears takes its confirm state with it, and no effect writes state back.

## Alternatives considered

**Put the buttons directly in the sidebar row.** It needs no hover card and no delay, but a row is 28px tall, holds a title, a status and an age, and the Session list is also the navigation surface. A destructive button beside a navigation target is the misclick this decision exists to avoid.

**A command, a diff, and a path inline in the 244px card.** A card that grows to fit them becomes unreadable at that width, and the row's own title, path and age already consume its first three lines. The card keeps those three lines, adds one action sentence, and puts the payload behind a disclosure that scrolls inside a fixed block.

**Answer every request in one click, including `danger-full-access`.** `.agents/notes` records the hover card as an easy misclick surface; a single click there would make the least reversible grant the cheapest one.

**Share one store between the two registrations.** The strip and the queue never need to see each other's state — each derives from the pending snapshot — so a store would add a module-level handle and a lifetime coupling for nothing.

**A client-side seam that asks the Conversation package for the call.** `ctx.approvalDetail` let `ui-chat` register a resolver over the assembled Tool-call node, which kept `ui-approval` free of a Conversation dependency. It also made the disclosure depend on a retained Conversation, so the payload appeared only after the asking Session had been opened — the exact navigation the hover card exists to remove.

**A Host-side queue endpoint.** The pending map already holds every Session's live request, and settlement already exists. A second path would need its own auth, its own cache, and its own invalidation.

## Consequences

Requests created by non-sandbox askers show their whole localized prompt as the action line, which can be several sentences. The strip clamps the action to three lines; the queue shows the same clamp, and the full prompt stays in the Session's composer card.

The widened card is a `HoverCard` option, not a per-plugin stylesheet override: the primitive owns positioning, edge fallbacks, and the compact width, so a caller that wants a different width asks for one. Every other row keeps the list-column width.

The danger tier is a closed set in `approval-facts.ts`. A future mode that also grants unrestricted access must be added there, or its requests will be granted in one click.

`pendingInteractions` is filter-then-map on the Client: the surfaces receive every domain's pending interaction and keep the `PendingApproval` instances. A Session showing a question therefore contributes nothing to either count.

The queue orders rows by Session map iteration, not by request time, because the pending map carries no timestamp. Adding one would mean a new Host field rather than a Client sort.
