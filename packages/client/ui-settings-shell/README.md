---
description: "The shell executor's settings page on the dsh web client's Plugins page — command timeout, per-stream output cap — and the Windows pwsh/Git Bash choice row in General settings."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-shell

English | [中文](README.zh.md)

## Summary

Open **Plugins** in the sidebar and select **Shell** in the Official group to set how long one command may run and how much of each output stream stays in memory. The page stages what is typed and writes it only on save, marks overridden values, and offers a reset to the deployment default. The page exists while the Host serves the `shell` namespace, so a deployment without a local shell executor shows no trace of it. On a Windows Host it also adds the **Command-line shell** row to General settings, choosing between PowerShell and Git Bash.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

The **Shell** card in the Official group opens the page. **Command timeout (ms)** ends a command that runs longer; **Output cap per stream (bytes)** spills output beyond it to a temporary file. Both render the effective value — the user's override over the composed default — and a field the user overrode carries an **Overridden** badge with **Reset to default** beside it. Nothing is written until **Save**; leaving the page drops the drafts, an empty field saves as a reset, and text that is not a number blocks the save and says so under the field.

On a Windows Host, General settings gains the **Command-line shell** row: choosing **PowerShell** or **Git Bash** flips both sides' executor and tool rows in one profile change, so exactly one shell stays composed. **Git Bash** stays disabled until an installation is found, and the row hides itself on non-Windows Hosts. An outcome toast reports a switch that needs a restart or is overridden by another profile layer.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The Host half is an empty `apply`, present only so the package holds a Loader row the client module system serves the browser half for. The browser half binds the composed shell executor entry (`bash-sandbox` off Windows, `pwsh-sandbox` on it) through `ctx.configForms.get`, keeps the staged form in `ShellCardController` over the shared `SettingsFormModel` of `ui-primitives`, and registers `ShellCard` into the Plugins page's `plugins.item` slot through `ctx.configForms.whileServed`, which registers while the Host serves either entry and withdraws when it stops. The page's copy lives in this package's `settings.shell` dictionary; the `SettingsForm` frame takes its copy as props.

The Windows choice row lives in the same browser half: `ShellChoiceSource` reads and switches through the `pluginManager` Remote endpoints, refreshes on `plugin-manager/changed`, and registers `ShellChoiceRow` into General settings' `settings.general.item` slot under `ctx.remoteAccess.whenAccess`, so the row and its toast appear only while the Host serves the plugin manager. The row renders nothing when the Host reports the choice unsupported.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [ui-plugin-manager](../ui-plugin-manager/README.md) — the Plugins page and the `plugins.item` slot the page registers into.
- [ui-settings](../ui-settings/README.md) — the settings scope and the served-namespace watch the page rides.
- [ui-primitives](../ui-primitives/README.md) — the settings form model and fields the page renders.
- [bash-local](../../shell/bash-local/README.md) — the executor that registers the `shell` namespace.

-----

<a id="model-experience"></a>
## Model Experience

None, as the package is a browser-side settings surface that registers no model surface.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **The page follows the composed executor** — the POSIX and PowerShell executor families share the `shell` namespace because a host composes exactly one of them, so the served schema differs by platform (PowerShell adds `pwshPath`) while the page edits the same two fields on both.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
