---
kind: upgrade-guide
description: "Deleting a temporary Session now removes its subagent descendants instead of being refused."
---

# A temporary Session's deletion takes its subagents with it

English | [中文](guide.zh.md)

## Change

`session.delete` used to refuse a temporary Session that owned subagent sessions, reporting `session/descendants`. No surface could then delete the children: the verb accepts only a temporary Session, and a subagent Session is never marked temporary, so a temporary Session that had once run a subagent was permanently undeletable and the sidebar's delete control failed on every attempt.

The deletion now removes that lineage in one operation: each descendant's live Agent and stored log, then the root's log, its directory under the temporary root, and its classification. Descendants go deepest first, so a failure part-way leaves the root — and with it the temporary classification that makes a retry reachable — in place. `session/descendants` no longer appears in `RemoteErrorDetailsMap`. The running-work refusal is unchanged: `session/active` already reports a running subagent descendant, and `stopActivity` stops it before the deletion proceeds.

A descendant's working directory is never claimed by this operation. A subagent's stored cwd is its root's directory, whose leaf name the root's own removal proves.

## Migration

1. Drop `session/descendants` handling from Host callers, SDK bindings, and automation that retried after that refusal; the verb no longer returns it, and TypeScript consumers narrowing on the code fail to compile until the case is removed.
2. Nothing stored changes. Descendant logs are ordinary Session artifacts, and a temporary Session that this refusal stranded becomes deletable after upgrade with no file editing.
3. Confirm that deleting a temporary Session that spawned a subagent removes both Session logs and its directory, leaves no Session row behind, and that the same deletion is still refused while that subagent runs until `stopActivity` stops it.
