---
kind: upgrade-guide
description: "ctx.sidebarRight's preferNewPane open option becomes beside, which can reuse an adjacent pane instead of splitting."
---

# Right Sidebar open placement

English | [中文](guide.zh.md)

## Change

`ctx.sidebarRight.openResource(address, options)` and `openTab(kind, options)` no longer take `preferNewPane: boolean`. Their replacement is `beside: 'before' | 'after'`, which lands new content in the pane beside the target pane on that side so the target's own tab stays visible. The pane already there is used when one exists; otherwise a new pane is split off the target under the normal two-pane budget and room rule; only when neither is available does the open fall back to the target pane. `tab.actions.openResource` and `tab.actions.openTab` take the same option object.

Placement behaviour therefore differs for callers as well as names: `preferNewPane: true` always split the target pane and fell back to it when it could not, while `beside` reuses a pane that already sits on the requested side. An open whose content previously made room by splitting now leaves the neighbouring pane in place. Only third-party client plugins call these options: the repository's own callers are updated in this release.

## Migration

1. In every `openResource` / `openTab` call, replace `preferNewPane: true` with `beside: 'after'` (trailing side) or `beside: 'before'` (leading side). TypeScript rejects the removed key.
2. Review each such call for the new reuse case: with a docked pane already on that side, the tab lands there instead of covering the target pane's tab. Name `paneId` when the tab must land in one exact pane, or pass `revealIfOpened: false` to permit a second copy.
3. Confirm the call compiles, and that the gesture leaves the triggering pane's tab visible beside the newly opened content.
