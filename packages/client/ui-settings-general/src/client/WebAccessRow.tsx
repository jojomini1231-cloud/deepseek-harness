/** General Settings control for serving this machine's browsers on a chosen loopback port. */
import { useEffect, useRef, useState } from 'react'
import { Button, IconCheckOutlineRegular, IconCopyOutlineRegular, Input, Switch, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { DesktopWebAccessChoice, DesktopWebAccessStatus } from '../types.ts'
import css from './WebAccessRow.module.css'

/** How long the copy control reports success, matching the product's other copy actions. */
const COPY_FEEDBACK_MS = 1000

/** Carrier state and writers supplied by the settings owner. */
export interface WebAccessRowInjected {
  hooks: { webAccess: ObservableSnapshot<{ readonly status?: DesktopWebAccessStatus; readonly failed: boolean }> }
  update(next: DesktopWebAccessChoice): Promise<void>
  open(): Promise<void>
  copyLink(): Promise<void>
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
 * Whether a draft is an external authority the shell would accept. The shell owns the
 * canonical rule, `parseWebAccessEndpoint` in `apps/desktop/src/web-access.ts`, and
 * revalidates every write; this copy only spares the user a round trip. It cannot import
 * that rule because this row is browser-bundled while the shell is Electron main.
 *
 * The two deliberately differ on the empty value alone: an empty text is how a person
 * clears a stored domain, so this accepts it while the parser, which is only ever called
 * with a value to publish, refuses it. Both specs enumerate the same non-empty vectors.
 * @param text - the draft as typed.
 * @returns true for an empty value, a bare `host[:port]`, or an absolute `http(s)://` URL.
 */
function isTrustedHost(text: string): boolean {
  if (text === '') return true
  if (/[\u0000-\x20\u007f]/u.test(text)) return false
  const absolute = /^https?:\/\//iu.test(text)
  if (absolute && (text.includes('?') || text.includes('#'))) return false
  const prefix = absolute ? text : `https://${text}`
  // WHATWG reads a backslash as a path separator under http(s), so the authority ends at
  // either slash, exactly as the shell's parser splits it.
  const [written = ''] = prefix.slice(prefix.indexOf('://') + 3).split(/[/\\]/, 1)
  if (written === '' || written.includes('@')) return false
  let url: URL
  try {
    url = new URL(prefix)
  } catch {
    return false
  }
  // Normalization must leave the written authority alone, apart from a redundant
  // scheme-default port and case; anything else WHATWG rewrites is a typo the shell
  // would refuse after a round trip.
  const lower = written.toLowerCase()
  if (lower !== url.host && lower !== `${url.host}:${url.protocol === 'https:' ? '443' : '80'}`) return false
  if (lower.startsWith('-') || url.host.endsWith('.')) return false
  return absolute || url.pathname === '/'
}

/**
 * One labelled text field with its own Apply action and validation report.
 * @param props - field identity, its current text, and the write it offers.
 * @returns the field group.
 */
function DraftField({ id, label, placeholder, inputMode, text, invalid, invalidText, applyLabel, pending, busy, onChange, onApply }: {
  id: string
  label: string
  placeholder?: string
  inputMode?: 'numeric'
  text: string
  invalid: boolean
  invalidText: string
  applyLabel: string
  pending: boolean
  busy: boolean
  onChange: (text: string) => void
  onApply: () => void
}) {
  return <div className={css.field}>
    <div className={css.fieldLine}>
      <label className={css.fieldLabel} htmlFor={id}>{label}</label>
      <Input
        id={id}
        value={text}
        disabled={busy}
        {...inputMode === undefined ? {} : { inputMode }}
        {...placeholder === undefined ? {} : { placeholder }}
        aria-invalid={invalid || undefined}
        onChange={(event) => { onChange(event.target.value) }}
      />
      {pending ? <Button variant="outline" disabled={busy} onClick={onApply}>{applyLabel}</Button> : null}
    </div>
    {invalid ? <span className={css.invalid} role="alert">{invalidText}</span> : null}
  </div>
}

/**
 * Render the Web access toggle, its port, its published domain, the live addresses, or
 * nothing when this shell exposes no carrier (an ordinary browser deployment).
 * @param props - carrier state, writers, and localized copy.
 * @returns the General Settings row.
 */
export function WebAccessRow({ useWebAccess, update, open, copyLink, portRange, defaultPort, t }:
  PropsRuntime<'settings.general.item'> & PropsLocale<'settings'> & InjectFace<WebAccessRowInjected>) {
  const view = useWebAccess(value => value)
  const status = view.status
  const [portDraft, setPortDraft] = useState<string | undefined>(undefined)
  const [hostDraft, setHostDraft] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  // A failed copy and a failed write are different failures with different remedies, and
  // nothing was saved by a copy, so they never share one message.
  const [copyFailed, setCopyFailed] = useState(false)
  const [opened, setOpened] = useState(false)
  const [copied, setCopied] = useState(false)
  const copyReset = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => { clearTimeout(copyReset.current) }, [])
  const storedPort = status?.port ?? defaultPort
  const storedHost = status?.trustedHost ?? ''
  const portText = portDraft ?? String(storedPort)
  const hostText = hostDraft ?? storedHost
  const port = parsePort(portText, portRange)
  const hostValid = isTrustedHost(hostText)
  // An unavailable carrier reports no status; the row owns nothing to render in that case.
  useEffect(() => {
    if (view.failed) setFailed(true)
  }, [view.failed])
  if (status === undefined && !view.failed) return null

  const enabled = status?.enabled ?? false
  // Each field offers its write only while its own draft is a usable value the listener
  // is not already running with; the other field's stored value rides along unchanged.
  const pendingPort = port !== undefined && portText !== String(storedPort) ? port : undefined
  const pendingHost = hostValid && hostText !== storedHost ? hostText : undefined

  const commit = (next: DesktopWebAccessChoice): void => {
    setFailed(false)
    setBusy(true)
    void update(next).then(() => {
      setPortDraft(undefined)
      setHostDraft(undefined)
    }, () => { setFailed(true) }).finally(() => { setBusy(false) })
  }

  return <div className={css.row}>
    <div className={css.body}>
      <div className={css.title}>{t('webAccess.title')}</div>
      <div className={css.description}>{t('webAccess.description')}</div>
      {/* Rendered only while the listener is on: an inert row exposes nothing. */}
      {enabled && <div className={css.warning}>{t('webAccess.riskNotice')}</div>}
      {/* An advertised http root puts the launch token in a cleartext link, and the Web
          profile's own plain-HTTP warning cannot fire here: it is gated on a non-loopback
          bind, which this listener never has. */}
      {status?.publicAddress?.startsWith('http://') === true
        && <div className={css.warning}>{t('webAccess.cleartextNotice')}</div>}
      {failed && <div role="alert" className={css.alert}>{t('webAccess.error')}</div>}
      {copyFailed && <div role="alert" className={css.alert}>{t('webAccess.copyError')}</div>}
      {status?.restartRequired === true && <div className={css.notice}>{t('webAccess.restartNotice')}</div>}
    </div>
    <div className={css.controls}>
      <DraftField
        id="settings-web-access-port"
        label={t('webAccess.portLabel')}
        inputMode="numeric"
        text={portText}
        invalid={port === undefined}
        invalidText={t('webAccess.invalidPort', { min: portRange.min, max: portRange.max })}
        applyLabel={t('webAccess.applyPort')}
        pending={pendingPort !== undefined}
        busy={busy}
        onChange={setPortDraft}
        onApply={() => { commit({ enabled, port: port as number, trustedHost: storedHost }) }}
      />
      <DraftField
        id="settings-web-access-host"
        label={t('webAccess.trustedHostLabel')}
        placeholder={t('webAccess.trustedHostHint')}
        text={hostText}
        invalid={!hostValid}
        invalidText={t('webAccess.invalidTrustedHost')}
        applyLabel={t('webAccess.applyTrustedHost')}
        pending={pendingHost !== undefined}
        busy={busy}
        onChange={setHostDraft}
        onApply={() => { commit({ enabled, port: storedPort, trustedHost: hostText }) }}
      />
      {status?.enabled === true && !status.restartRequired
        ? (
          <>
            {status.publicAddress !== null && (
              <div className={css.address}>
                <span className={css.addressText}>{t('webAccess.publicAddress', { address: status.publicAddress })}</span>
                <Tooltip label={copied ? t('webAccess.copied') : t('webAccess.copyLink')} side="bottom" align="end" portal>
                  <button
                    type="button"
                    className={css.iconAction}
                    aria-label={copied ? t('webAccess.copied') : t('webAccess.copyLink')}
                    disabled={busy}
                    onClick={() => {
                      setCopyFailed(false)
                      setCopied(false)
                      void copyLink().then(() => {
                        setCopied(true)
                        clearTimeout(copyReset.current)
                        copyReset.current = setTimeout(() => { setCopied(false) }, COPY_FEEDBACK_MS)
                      }, () => { setCopyFailed(true) })
                    }}
                  >{copied ? <IconCheckOutlineRegular size={14} /> : <IconCopyOutlineRegular size={14} />}</button>
                </Tooltip>
              </div>
            )}
            {status.address !== null && (
              <div className={css.address}>
                <span className={css.addressText}>{t('webAccess.address', { address: status.address })}</span>
                <Button variant="outline" disabled={busy} onClick={() => {
                  setFailed(false)
                  setOpened(false)
                  void open().then(() => { setOpened(true) }, () => { setFailed(true) })
                }}>{t('webAccess.open')}</Button>
                {opened && <span className={css.notice} role="status">{t('webAccess.opened')}</span>}
              </div>
            )}
          </>
        )
        : null}
      <Switch checked={enabled} disabled={busy} label={t('webAccess.title')}
        onChange={(next) => {
          // Flipping the switch must not discard a port the user typed and has not applied.
          commit({ enabled: next, port: port ?? storedPort, trustedHost: hostValid ? hostText : storedHost })
        }} />
    </div>
  </div>
}
