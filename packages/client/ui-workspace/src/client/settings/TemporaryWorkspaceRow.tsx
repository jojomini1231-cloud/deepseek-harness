/**
 * General Settings row for the root directory of temporary Session
 * workspaces. The row is a staged form in the same shape as a plugin page:
 * the value is written by the row's own Save, so a half-typed path never
 * reaches the Host, and the field's reset restores the derived default.
 */
import { SettingsForm, SettingsValueField } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { formLabels } from '../locales.ts'
import type { TemporaryWorkspaceRowInjected } from './temporary-workspace-controller.ts'
import { TEMPORARY_DIRECTORY_FIELD } from './temporary-workspace-controller.ts'
import css from './TemporaryWorkspaceRow.module.css'

/** Full Settings-row props: runtime share, locale seat, and the row's staged form face. */
export type TemporaryWorkspaceRowProps =
  PropsRuntime<'settings.general.item'>
  & PropsLocale<'workspace'>
  & InjectFace<TemporaryWorkspaceRowInjected>

/**
 * Render the temporary-workspace directory row.
 * @param props - composed Settings slot props.
 * @returns the preference row.
 */
export function TemporaryWorkspaceRow(props: TemporaryWorkspaceRowProps) {
  const { t } = props
  const state = props.useTemporaryWorkspace(snapshot => snapshot)
  const disabled = !state.writable
  return (
    <div className={css.row}>
      <div className={css.title}>{t('temporaryDirectory.title')}</div>
      <div className={css.description}>{t('temporaryDirectory.description')}</div>
      <SettingsForm labels={formLabels(t)} state={state} onSave={props.save} onDiscard={props.discard}>
        <SettingsValueField
          id="plugin-config-temporary-workspace-directory"
          label={t('temporaryDirectory.field')}
          hint={t('temporaryDirectory.hint')}
          overriddenLabel={t('temporaryDirectory.overridden')}
          resetLabel={t('temporaryDirectory.reset')}
          invalidLabel={t('temporaryDirectory.invalid')}
          disabled={disabled}
          {...state.directory}
          onEdit={(text) => { props.edit(TEMPORARY_DIRECTORY_FIELD, text) }}
          onReset={() => { props.resetField(TEMPORARY_DIRECTORY_FIELD) }}
        />
        <button
          type="button"
          className={css.browse}
          disabled={disabled}
          onClick={() => {
            props.browse().catch((error: unknown) => {
              console.warn('temporary workspace directory pick failed:', error)
            })
          }}
        >
          {t('temporaryDirectory.browse')}
        </button>
      </SettingsForm>
    </div>
  )
}
