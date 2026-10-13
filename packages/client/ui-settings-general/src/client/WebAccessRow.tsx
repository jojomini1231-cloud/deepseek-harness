/** General Settings control for serving this machine's browsers on a chosen loopback port. */
import { useEffect, useState } from 'react'
import { Button, Input, Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { DesktopWebAccessChoice, DesktopWebAccessStatus } from '../types.ts'
import css from './WebAccessRow.module.css'

/** Carrier state and writers supplied by the settings owner. */
export interface WebAccessRowInjected {
  hooks: { webAccess: ObservableSnapshot<{ readonly status?: DesktopWebAccessStatus; readonly failed: boolean }> }
  update(next: DesktopWebAccessChoice): Promise<void>
  open(): Promise<void>
  /** Inclusive port range the shell accepts, shared so the row rejects the same drafts. */
  portRange: { readonly min: number; readonly max: number }
  defaultPort: number
}

/** Whether a draft is a port the shell would accept. */
function parsePort(text: string, range: { min: number; max: number }): number | undefined {
  if (!/^\d+$/.test(text)) return undefined
  const value = Number(text)
  return Number.isInteger(value) && value >= range.min && value <= range.max ? value : undefined
}

/**
 * Render the Web access toggle, its port, and the live address, or nothing when this
 * shell exposes no carrier (an ordinary browser deployment).
 * @param props - carrier state, writers, and localized copy.
 * @returns the General Settings row.
 */
export function WebAccessRow({ useWebAccess, update, open, portRange, defaultPort, t }:
  PropsRuntime<'settings.general.item'> & PropsLocale<'settings'> & InjectFace<WebAccessRowInjected>) {
  const view = useWebAccess(value => value)
  const status = view.status
  const [draft, setDraft] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const [opened, setOpened] = useState(false)
  const text = draft ?? (status === undefined ? String(defaultPort) : String(status.port))
  const port = parsePort(text, portRange)
  // An unavailable carrier reports no status; the row owns nothing to render in that case.
  useEffect(() => {
    if (view.failed) setFailed(true)
  }, [view.failed])
  if (status === undefined && !view.failed) return null

  const enabled = status?.enabled ?? false
  const invalid = port === undefined
  // An out-of-range draft offers no write; an in-range draft equal to the stored port has
  // nothing to apply until the user types — so the port itself is the pending value.
  const pendingPort = port !== undefined && (port !== status?.port || draft === undefined) ? port : undefined

  const commit = (next: DesktopWebAccessChoice): void => {
    setFailed(false)
    setBusy(true)
    void update(next).then(() => { setDraft(undefined) }, () => { setFailed(true) }).finally(() => { setBusy(false) })
  }

  return <div className={css.row}>
    <div className={css.body}>
      <div className={css.title}>{t('webAccess.title')}</div>
      <div className={css.description}>{t('webAccess.description')}</div>
      {failed && <div role="alert" className={css.alert}>{t('webAccess.error')}</div>}
      {status?.restartRequired === true && <div className={css.notice}>{t('webAccess.restartNotice')}</div>}
    </div>
    <div className={css.controls}>
      <div className={css.port}>
        <label className={css.portLabel} htmlFor="settings-web-access-port">{t('webAccess.portLabel')}</label>
        <Input
          id="settings-web-access-port"
          inputMode="numeric"
          value={text}
          disabled={busy}
          aria-invalid={invalid || undefined}
          onChange={(event) => { setDraft(event.target.value) }}
        />
        {pendingPort !== undefined
          ? <Button variant="outline" disabled={busy} onClick={() => { commit({ enabled, port: pendingPort }) }}>{t('webAccess.applyPort')}</Button>
          : null}
        {invalid
          ? <span className={css.invalid} role="alert">{t('webAccess.invalidPort', { min: portRange.min, max: portRange.max })}</span>
          : null}
      </div>
      {status?.enabled === true && status.address !== null && !status.restartRequired
        ? (
          <div className={css.address}>
            <span className={css.addressText}>{t('webAccess.address', { address: status.address })}</span>
            <Button variant="outline" disabled={busy} onClick={() => {
              setFailed(false)
              setOpened(false)
              void open().then(() => { setOpened(true) }, () => { setFailed(true) })
            }}>{t('webAccess.open')}</Button>
            {opened && <span className={css.notice} role="status">{t('webAccess.opened')}</span>}
          </div>
        )
        : null}
      <Switch checked={enabled} disabled={busy} label={t('webAccess.title')}
        onChange={(next) => { commit({ enabled: next, port: port ?? status?.port ?? defaultPort }) }} />
    </div>
  </div>
}
