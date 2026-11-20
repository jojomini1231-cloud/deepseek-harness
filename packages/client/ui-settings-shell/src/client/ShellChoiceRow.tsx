/** The Windows shell executor choice: a General-settings row selecting PowerShell or Git Bash. */
import { useState } from 'react'
import { Menu, Toast, IconWarningOutlineRegular, IconLoadingOutlineRegular, IconChevronDownOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ShellChoiceSource, ShellExecutorChoice } from './shell-choice-source.ts'
import css from './ShellChoiceRow.module.css'

/** Framework-bound choice state and the explicit switch action. */
export interface ShellChoiceRowInjected {
  hooks: { choice: ShellChoiceSource['store'] }
  select(choice: ShellExecutorChoice): Promise<void>
}

/**
 * Render the Windows-only executor control. The row shows nothing until the
 * Host names a supported selection, so other platforms never see it.
 * @param props - Shell observation, switch action and localized copy.
 * @returns The General settings row, or nothing on an unsupported Host.
 */
export function ShellChoiceRow({ useChoice, select, t }:
  PropsRuntime<'settings.general.item'> & PropsLocale<'settings.shell'> & InjectFace<ShellChoiceRowInjected>) {
  const { state, failed, pending } = useChoice(value => value)
  const [open, setOpen] = useState(false)
  if (state?.supported !== true) return null
  const busy = pending !== undefined
  const active = pending ?? state.active
  const gitBashMissing = state.gitBashPath === undefined
  return <div className={css.row} role="group" aria-label={t('choiceTitle')}>
    <div className={css.rowText}>
      <div className={css.title}>{t('choiceTitle')}</div>
      <div className={css.description}>{t('choiceDescription')}</div>
      {(failed || state.active === undefined) && <div role="alert">{t(failed ? 'choiceReadError' : 'choiceUnavailable')}</div>}
    </div>
    <Menu open={open} onClose={() => { setOpen(false) }} portal align="end"
      selectedId={active ?? ''}
      items={[
        { id: 'pwsh', label: t('choicePwsh') },
        { id: 'git-bash', label: t('choiceGitBash'), ...(gitBashMissing ? { disabled: true, disabledReason: t('choiceGitBashMissing') } : {}) },
      ]}
      onSelect={(id) => {
        setOpen(false)
        void select(id as ShellExecutorChoice)
      }}
      anchor={<button type="button" className={css.selector} disabled={busy || state.active === undefined}
        aria-busy={busy} aria-label={t('choiceTitle')} aria-haspopup="menu" aria-expanded={open}
        onClick={() => { setOpen(!open) }}>
        {active === undefined ? t('choiceUnavailable') : t(active === 'pwsh' ? 'choicePwsh' : 'choiceGitBash')}
        {busy ? <IconLoadingOutlineRegular className={css.spinner} /> : <IconChevronDownOutlineRegular className={css.chevron} />}
      </button>} />
  </div>
}

/** Shell-owned switch feedback that survives closing Settings. */
export interface ShellChoiceToastInjected {
  hooks: { choice: ShellChoiceSource['store'] }
  dismiss(sequence: number): void
}

/**
 * Render the latest executor switch result outside Settings.
 * @param props - Shared operation state, dismissal and localized copy.
 * @returns A transient toast, or nothing.
 */
export function ShellChoiceToast({ useChoice, dismiss, t }:
  PropsRuntime<'shell.overlay'> & PropsLocale<'settings.shell'> & InjectFace<ShellChoiceToastInjected>) {
  const notice = useChoice(value => value.notice)
  if (notice === undefined) return null
  return <Toast key={notice.sequence} text={t(`choiceResult.${notice.outcome}`)}
    {...notice.outcome === 'applied' ? { tone: 'success' as const } : { icon: <IconWarningOutlineRegular /> }}
    onDone={() => { dismiss(notice.sequence) }} />
}
