/**
 * The shell executor's settings page, browser half: the command timeout and
 * the per-stream output cap over the `shell` namespace the executor
 * registers. The page registers into the Plugins page's `plugins.item` slot
 * while the Host serves that namespace, so a deployment without a local shell
 * executor shows no trace of it.
 */

// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the ctx.configForms Context merge. Cross-plugin collaboration
// goes through the service, never a value import (client bundle purity gate).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: the Plugins page's SlotMap merge (the 'plugins.item' entry).
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-api-remote-access/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { ShellCard } from './ShellCard.tsx'
import { ShellChoiceRow, ShellChoiceToast } from './ShellChoiceRow.tsx'
import { ShellChoiceSource } from './shell-choice-source.ts'
import { BASH_NS, PWSH_NS, ShellCardController } from './shell-card-controller.ts'
import { en, ja, es, fr, de, ru, pt, zh, type ShellSettingsLocaleKey } from './locales.ts'

export type { ShellCardProps } from './ShellCard.tsx'
export type { ShellCardFace, ShellCardState, ShellSettings } from './shell-card-controller.ts'
export type { ShellSettingsLocaleKey } from './locales.ts'
export type { ShellChoiceRemote, ShellChoiceSnapshot, ShellExecutorChoice } from './shell-choice-source.ts'
export type { ShellChoiceRowInjected, ShellChoiceToastInjected } from './ShellChoiceRow.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Shell settings page copy. */
    'settings.shell': ShellSettingsLocaleKey
  }
}

/** Dictionary namespace owned by this plugin. */
export const NS = 'settings.shell'

/** Required services (cordis fiber inject). */
export const inject = ['slots', 'locale', 'configForms', 'remote', 'remote.pluginManager', 'remoteAccess']

/**
 * Mount the shell settings page while the Host serves its namespace.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.locale.register(NS, { zh, en, ja, es, fr, de, ru, pt }), 'ui-settings-shell: dictionaries')
  // The base bundle composes exactly one shell executor per platform; the page binds the served one.
  const bash = new ShellCardController(ctx.configForms.get(BASH_NS))
  const pwsh = new ShellCardController(ctx.configForms.get(PWSH_NS))
  ctx.effect(() => () => { bash.dispose(); pwsh.dispose() }, 'ui-settings-shell: form subscriptions')
  ctx.effect(() => ctx.configForms.whileServed([BASH_NS, PWSH_NS], served => ctx.slots.inject('plugins.item', () => ctx.slots.register({
    name: 'plugins.item', id: 'shell', order: 40, label: () => t('title'), locale: NS, inject: () => (served.has(PWSH_NS) ? pwsh : bash).inject(),
  }, ShellCard))), 'ui-settings-shell: page')

  // A Windows host composes exactly one executor pair; this row switches it.
  // The Host says what is supported, so other platforms keep an empty slot.
  const choice = new ShellChoiceSource(ctx.remote.pluginManager)
  ctx.effect(() => () => { choice.dispose() }, 'ui-settings-shell: choice subscription')
  ctx.effect(() => ctx.remoteAccess.whenAccess('pluginManager/getShellExecutorSelection', function* () {
    // The Host announces its own composition changes — from this row, the
    // Plugins page, or the CLI — and a read made while access was withdrawn
    // may have failed without the row showing it.
    void choice.refresh()
    yield ctx.remote.$on('plugin-manager/changed', () => { void choice.refresh() })
    yield ctx.slots.inject('settings.general.item', () => ctx.slots.register({
      name: 'settings.general.item', id: 'shell-executor', order: 25, locale: NS,
      inject: () => ({ hooks: { choice: choice.store }, select: (value: 'pwsh' | 'git-bash') => choice.select(value) }),
    }, ShellChoiceRow))
    yield ctx.slots.inject('shell.overlay', () => ctx.slots.register({
      name: 'shell.overlay', id: 'shell-choice-toast', locale: NS,
      inject: () => ({ hooks: { choice: choice.store }, dismiss: (sequence: number) => { choice.dismissNotice(sequence) } }),
    }, ShellChoiceToast))
  }), 'ui-settings-shell: choice row')
}
