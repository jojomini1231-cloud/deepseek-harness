/**
 * The General settings row's staged form over the Workspace controller's
 * entry: the root under which each temporary Session's directory is created.
 *
 * The field is `volatile` in the controller's schema, which is what puts it on
 * the browser's settings surface at all; this row is the visible half. Leaving
 * it unset is the normal state — the Host then derives
 * `<Documents>/deepseek-harness/temporary-workspaces` — so the reset control
 * clears the profile entry rather than writing a value the client guessed at.
 */

import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import {
  SettingsFormModel, settingsTextField,
  type SettingsFieldState, type SettingsFormActions, type SettingsFormScope, type SettingsFormShell,
} from '@deepseek-ai/dsh-client-ui-primitives'

/**
 * Profile entry id of the Workspace controller. Spelled here rather than
 * imported: a client package must not depend on a Host package.
 */
export const WORKSPACE_CONTROLLER_NS = 'workspace-controller'

/** The field this row edits — the only volatile one the entry declares today. */
export const TEMPORARY_DIRECTORY_FIELD = 'temporaryWorkspaceDirectory'

/** The Workspace entry's fields this row edits; the section carries others. */
export interface TemporaryWorkspaceSettings {
  /** Root for temporary Session directories; unset derives the Documents default. */
  temporaryWorkspaceDirectory?: string
}

/** What the General row renders. */
export interface TemporaryWorkspaceRowState extends SettingsFormShell {
  /** The staged directory root. */
  directory: SettingsFieldState
}

/** The registration-side face the row's slot entry injects. */
export interface TemporaryWorkspaceRowInjected extends SettingsFormActions {
  hooks: {
    /** Row snapshot bound by the renderer as useTemporaryWorkspace. */
    temporaryWorkspace: SnapshotStore<TemporaryWorkspaceRowState>
  }
  /**
   * Open the Host-native directory picker and stage the choice.
   * @returns settlement after the picker closes; a cancelled pick stages nothing.
   */
  browse(): Promise<void>
}

/** Bridges the Workspace controller's form onto the General row's staged form. */
export class TemporaryWorkspaceRowController {
  private readonly form: SettingsFormModel<TemporaryWorkspaceSettings>
  private readonly store: SnapshotStore<TemporaryWorkspaceRowState>

  /**
   * @param scope - the shared configuration form of the composed Workspace controller entry.
   * @param pick - the Host-native directory picker; null when the user cancelled.
   */
  constructor(
    scope: SettingsFormScope<TemporaryWorkspaceSettings>,
    private readonly pick: () => Promise<string | null>,
  ) {
    this.form = new SettingsFormModel(scope, [settingsTextField(TEMPORARY_DIRECTORY_FIELD)])
    this.store = this.form.bind(() => this.projection())
  }

  private projection(): TemporaryWorkspaceRowState {
    return { ...this.form.shell(), directory: this.form.field(TEMPORARY_DIRECTORY_FIELD) }
  }

  /**
   * Build the face the row's slot registration injects.
   * @returns the row's snapshot and its form actions.
   */
  inject(): TemporaryWorkspaceRowInjected {
    return {
      hooks: { temporaryWorkspace: this.store },
      ...this.form.actions(),
      browse: async () => {
        const directory = await this.pick()
        // A cancelled pick leaves the draft exactly as the user left it.
        if (directory !== null) this.form.actions().edit(TEMPORARY_DIRECTORY_FIELD, directory)
      },
    }
  }

  /** Release the form subscription. */
  dispose(): void { this.form.dispose() }
}
