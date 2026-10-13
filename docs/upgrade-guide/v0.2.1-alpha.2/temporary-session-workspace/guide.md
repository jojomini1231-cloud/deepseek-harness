---
kind: upgrade-guide
description: "Sessions can be started without a Workspace, and the workspace-controller entry gains a temporaryWorkspaceDirectory setting."
---

# Start a Session without a Workspace

English | [中文](guide.zh.md)

## Change

Web and Desktop can now start a workspace-less temporary Session. Beside the sidebar's New Session control, a New temporary session control creates a Session with no Workspace: the Host creates `<temporary root>/<sessionId>` and uses it as the Session's working directory, and the Session appears in a new Temporary Workspaces sidebar section instead of under a Workspace. That section is a sibling of the Workspaces section, with its own search field, view options, and New temporary session button, and it renders whether or not it holds any Session. A temporary Session can be moved to a Workspace later, but it stays in the Temporary Workspaces section, which is defined by creation entry point rather than by directory.

The `workspace-controller` cordis.yml entry gains a `temporaryWorkspaceDirectory` setting, editable on Settings → General. Unset derives `<Documents>/deepseek-harness/temporary-workspaces`. The workspace domain's durable state gains `temporarySessionIds`, defaulted to `[]`.

## Migration

1. **The `workspace-controller` entry now requires its Config.** `temporaryWorkspaceDirectory` is a required key, `documentsLookupTimeoutMs` is no longer optional, and the plugin constructor no longer defaults its argument. Programmatic construction — `new WorkspaceController(ctx)` with no argument — now fails to compile and to load. A cordis.yml row that omitted its `config` block still loads: the schema tolerates an absent or empty object, deriving `documentsLookupTimeoutMs` from its default and `temporaryWorkspaceDirectory` as unset. Supply the block with `temporaryWorkspaceDirectory: !!js undefined` to keep the derived default, or point it at a directory.
2. No stored data changes: existing workspace storage records parse unchanged, because `temporarySessionIds` defaults to `[]`. No profile patch or Session file needs rewriting.
3. To pin the temporary root, set it on Settings → General, or add `temporaryWorkspaceDirectory` to the `@deepseek-ai/dsh-api-workspace-controller` row in cordis.yml.
4. Confirm the entry loads with no validation error and that a new temporary Session's directory lands under the configured root.
