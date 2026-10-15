/** The Device management settings page: the browsers that reached this deployment. */

import { useEffect, useState } from 'react'
import type { BrowserDeviceView } from '@deepseek-ai/dsh-api-remotes/client'
import { Button, Input, Modal, relativeTime } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './DevicesSection.module.css'
import type { DevicesInjected } from './device-store.ts'
import { deriveDeviceName } from './ua.ts'

/**
 * How often the page re-samples the clock its relative dates read against.
 * Half the finest bucket `relativeTime` resolves, so a date crossing a bucket
 * boundary shows its new label within half a bucket of crossing it.
 */
const CLOCK_INTERVAL_MS = 30_000

/** Placeholder rows the loading skeleton lays out in the roster's list. */
const SKELETON_ROWS = [0, 1] as const

/** Owner, locale, and injected shares the renderer binds for this page. */
export type DevicesSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'settings.devices'>
  & InjectFace<DevicesInjected>

/**
 * Render the device roster with its rename and revoke controls.
 * @param props - section owner share, locale copy, and the roster face.
 * @returns the page element tree.
 */
export function DevicesSection(props: DevicesSectionProps) {
  const { t, useDevices, refresh, rename, revoke } = props
  const state = useDevices(snapshot => snapshot)
  const [renaming, setRenaming] = useState<BrowserDeviceView | undefined>(undefined)
  const [revoking, setRevoking] = useState<BrowserDeviceView | undefined>(undefined)
  const [failure, setFailure] = useState<'rename' | 'revoke' | undefined>(undefined)

  // The roster is read when the page appears, not when the plugin activates:
  // a deployment whose operator never opens Settings makes no devices call.
  useEffect(() => { void refresh() }, [refresh])

  // A page left open re-reads its dates on a timer; without one, a device idle
  // since the page opened keeps claiming it was seen "just now".
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = setInterval(() => { setNow(Date.now()) }, CLOCK_INTERVAL_MS)
    return () => { clearInterval(timer) }
  }, [])

  // Only the first read has nothing to show; a re-read after a write keeps the
  // rows the operator is looking at rather than replacing them with placeholders.
  const loading = state.status === 'loading' && state.devices.length === 0
  return (
    <div className={css.section} aria-busy={loading}>
      <h2 className={css.title}>{t('title')}</h2>
      <p className={css.description}>{t('description')}</p>
      {loading && (
        <>
          <span className={css.visuallyHidden} role="status">{t('loading')}</span>
          <ul className={css.rows} aria-hidden="true">
            {SKELETON_ROWS.map(slot => <li key={slot} className={css.skeletonRow} />)}
          </ul>
        </>
      )}
      {state.status === 'error' && (
        <div className={css.notice} role="alert">
          <span>{state.signedOut ? t('signedOut') : t('loadFailed')}</span>
          {/* A browser that revoked itself cannot read the roster again, so
              retrying is not an action that could succeed. */}
          {!state.signedOut && (
            <Button variant="outline" size="sm" onClick={() => { void refresh() }}>{t('retry')}</Button>
          )}
        </div>
      )}
      {/* A refused write answers the operator's own action, so it is announced
          politely rather than interrupting whatever they do next. */}
      {failure !== undefined && (
        <p className={css.notice} role="status">
          {t(failure === 'rename' ? 'renameFailed' : 'revokeFailed')}
        </p>
      )}
      {state.status === 'ready' && state.devices.length === 0 && <p className={css.empty}>{t('empty')}</p>}
      <ul className={css.rows}>
        {state.devices.map((device: BrowserDeviceView) => (
          <DeviceRow
            key={device.id}
            device={device}
            t={t}
            now={now}
            pending={state.pending.includes(device.id)}
            onRename={() => { setFailure(undefined); setRenaming(device) }}
            onRevoke={() => { setFailure(undefined); setRevoking(device) }}
          />
        ))}
      </ul>
      {renaming !== undefined && (
        <RenameDialog
          device={renaming}
          t={t}
          onClose={() => { setRenaming(undefined) }}
          onSave={async (name) => {
            const target = renaming
            setRenaming(undefined)
            // The outcome replaces the previous one either way: a stale refusal
            // left standing over an accepted write misreports the roster.
            setFailure(await rename(target.id, name) === 'failed' ? 'rename' : undefined)
          }}
        />
      )}
      {revoking !== undefined && (
        <RevokeDialog
          device={revoking}
          t={t}
          onClose={() => { setRevoking(undefined) }}
          onConfirm={async () => {
            const target = revoking
            setRevoking(undefined)
            setFailure(await revoke(target.id) === 'failed' ? 'revoke' : undefined)
          }}
        />
      )}
    </div>
  )
}

/** Locale reader this page's components receive. */
type Translate = DevicesSectionProps['t']

/** One device row: its derived or user-set name, facts, and controls. */
function DeviceRow({ device, t, now, pending, onRename, onRevoke }: {
  device: BrowserDeviceView
  t: Translate
  now: number
  pending: boolean
  onRename: () => void
  onRevoke: () => void
}) {
  // The row's own controls name the device they act on: read on their own, a
  // list of identical "Revoke" buttons does not say which browser it revokes.
  const label = device.name ?? derivedName(device, t)
  return (
    <li className={css.row}>
      <div className={css.identity}>
        <span className={css.name}>{label}</span>
        <span className={css.agent}>{device.userAgent}</span>
      </div>
      <dl className={css.facts}>
        <dt>{t('lastSeen')}</dt>
        <dd>{timeText(device.lastSeenAt, now, t)}</dd>
        <dt>{t('firstSeen')}</dt>
        <dd>{timeText(device.firstSeenAt, now, t)}</dd>
        {device.address !== undefined && (
          <>
            <dt>{t('address')}</dt>
            <dd>{device.address}</dd>
          </>
        )}
      </dl>
      <div className={css.actions}>
        <Button
          variant="outline"
          size="sm"
          disabled={pending}
          aria-label={t('renameDevice', { name: label })}
          onClick={onRename}
        >
          {t('rename')}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className={css.dangerAction}
          disabled={pending}
          aria-label={t('revokeDevice', { name: label })}
          onClick={onRevoke}
        >
          {t('revoke')}
        </Button>
      </div>
    </li>
  )
}

/** The label dialog; its draft starts from the current label, never the derived name. */
function RenameDialog({ device, t, onClose, onSave }: {
  device: BrowserDeviceView
  t: Translate
  onClose: () => void
  onSave: (name: string) => Promise<void>
}) {
  const [draft, setDraft] = useState(device.name ?? '')
  return (
    <Modal
      open
      onClose={onClose}
      title={t('renameTitle')}
      closeLabel={t('cancel')}
      description={t('renameHint')}
      footer={(
        <>
          <Button variant="outline" onClick={onClose}>{t('cancel')}</Button>
          <Button variant="primary" onClick={() => { void onSave(draft) }}>{t('save')}</Button>
        </>
      )}
    >
      <Input
        value={draft}
        placeholder={t('renamePlaceholder')}
        aria-label={t('renameLabel')}
        data-modal-autofocus
        onChange={(event) => { setDraft(event.target.value) }}
      />
    </Modal>
  )
}

/** The revoke confirmation. Reaching one's own device is stated, not preventable. */
function RevokeDialog({ device, t, onClose, onConfirm }: {
  device: BrowserDeviceView
  t: Translate
  onClose: () => void
  onConfirm: () => Promise<void>
}) {
  return (
    <Modal
      open
      onClose={onClose}
      title={t('revokeTitle')}
      closeLabel={t('cancel')}
      description={t('revokeMessage')}
      footer={(
        <>
          <Button variant="outline" onClick={onClose}>{t('cancel')}</Button>
          <Button variant="primary" className={css.dangerConfirm} onClick={() => { void onConfirm() }}>
            {t('revokeConfirm')}
          </Button>
        </>
      )}
    >
      <span className={css.name}>{device.name ?? derivedName(device, t)}</span>
    </Modal>
  )
}

/** The name a device derives from its own User-Agent, in the interface language. */
function derivedName(device: BrowserDeviceView, t: Translate): string {
  const { browser, platform } = deriveDeviceName(device.userAgent)
  return `${t(`browser.${browser}`)} · ${t(`platform.${platform}`)}`
}

/** One relative-time label in the interface language. */
function timeText(at: number, now: number, t: Translate): string {
  const { unit, n } = relativeTime(at, now)
  if (unit === 'now') return t('time.now')
  return t(`time.${unit}`, { n })
}
