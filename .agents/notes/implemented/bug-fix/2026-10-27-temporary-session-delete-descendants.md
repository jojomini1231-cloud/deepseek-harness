# Agent Note: Deleting a temporary Session removes its subagent descendants

Status: implemented

English | [中文](2026-10-27-temporary-session-delete-descendants.zh.md)

## Problem

`session.delete` refused a temporary Session that owned subagent sessions with `session/descendants`, on the reasoning that removing the root would leave children no surface could reach. The same verb accepts only a temporary Session, and the temporary set is minted solely by the temporary create path, so no surface could ever delete those children either. A temporary Session that had once spawned a subagent was therefore permanently undeletable: the sidebar's Delete session control failed on every attempt, and the Session could not be recovered from the UI at all.

The refusal also ran before the running-work check, so the reported failure was always the descendants one, even when the work that had to stop was the child's own turn.

## Decision

The deletion removes the whole lineage it owns: for each subagent descendant its live Agent and stored log, then the root's log, its directory under the temporary root, and its classification in the Workspace registry. Descendants are visited deepest first, taken from the reverse of the breadth-first lineage walk, so a failure part-way leaves the root — and with it the temporary classification that makes the retry reachable — in place. Deleting a descendant's log before its parent's also keeps the retry convergent: a removed child no longer appears in the walk, and no surviving grandchild is left outside every reachable lineage.

No descendant directory is claimed. A subagent's stored working directory is its root's, whose leaf name is the proof the root's own removal uses, so the per-session directory step stays a root-only step.

`session/descendants` leaves `RemoteErrorDetailsMap`. Running work already refuses the deletion as `session/active`, and the Subagent runtime's `workspace/session-activity` listener answers for running descendants at any depth, so a live child still blocks the deletion until `stopActivity` stops it.

## Alternatives considered

**Mark subagent children temporary.** This would let each child be deleted separately, but it pollutes the Temporary workspaces section with rows the user never created, and it splits one user action into an unpredictable number of steps the user has to discover.

**Delete the children from the Client before the root.** The verb refuses a non-temporary Session, so this needs the server rule anyway; doing it client-side would also leave a partial state visible after a failure.

**Keep the refusal and delete the descendants from a separate verb.** A second verb would exist only for a case no surface needs to express separately: the children are reachable only through the parent, and the parent is being destroyed.

## Verification

- `packages/api/session-controller/tests/commands-delete.host.spec.ts` asserts the deepest-first order of log deletion, agent disposal, and registry forgets for a parent, child, and grandchild, and that a failing descendant leaves the root and its classification in place.
- `apps/web/tests/temporary-workspace.e2e.ts` deletes a temporary Session that owns a seeded subagent through the shipped sidebar dialog and asserts both stored logs and the directory are gone. Removing this decision fails that case with the row still present.
- `packages/client/ui-workspace/tests/session-actions.client.spec.tsx` pins the confirmation copy, which now names the subagent sessions.

## Consequences

- Deleting a temporary Session is destructive across the lineage: a continuable child's history goes with it, and `send_message` to that child afterwards reports `subagent/not-found`.
- A Session this refusal stranded before the change becomes deletable after upgrade with no file editing; the upgrade guide records the removed error code.
