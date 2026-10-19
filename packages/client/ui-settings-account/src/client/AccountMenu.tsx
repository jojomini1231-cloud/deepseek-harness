/** Sidebar account launcher and locally authoritative sign-out action. */
import { useEffect, useId, useRef, useState } from 'react'
import {
  Toast, Menu, IconEllipsisOutlineMedium, IconPaperPlaneOutlineMedium, IconSettingsOutlineMedium, IconUserOutlineMedium,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { AccountDetails, AccountUsageOutcome } from '@deepseek-ai/dsh-deepseek-account/types'
import type { AccountSectionInjected } from './AccountSection.tsx'
import { SignOutDialog } from './SignOutDialog.tsx'
import { SignInDialog } from './SignInDialog.tsx'
import { LogoutIcon } from './LogoutIcon.tsx'
import { AccountAvatar } from './AccountAvatar.tsx'
import { AccountNoticeStack } from './AccountNotice.tsx'
import { formatUsageCost, formatWallets, usageMeter } from './formatUsage.ts'
import css from './AccountMenu.module.css'

/** Account launcher composed by the settings shell. */
export type AccountMenuProps = PropsRuntime<'settings.launcher'> & PropsLocale<'settings.account'> & InjectFace<AccountSectionInjected>

/** The signed-in label stays empty while the profile loads.
 * @param props - sidebar geometry, settings navigation and account operations.
 * @returns account menu launcher.
 */
export function AccountMenu({
  subscribeSessionExpired, subscribeModelSignInRequired, wide, settingsShortcut, openSettings, openOnboarding, settingsOpen,
  useAccount, useTheme, signOut, hasRunningAccountTasks, refreshAccount, bonusNoticeShown, bonusNoticeDismissed,
  contactUs, showLogin, start, cancel, avatarFailed, readUsage, t,
}: AccountMenuProps) {
  const anchor = useRef<HTMLDivElement>(null)
  // The launcher outlives the panel, so a false-to-true edge is one Settings entry:
  // re-renders, section switches and tab switches inside one open must not read again.
  const settingsWasOpen = useRef(false)
  useEffect(() => {
    if (settingsOpen && !settingsWasOpen.current) void refreshAccount()
    settingsWasOpen.current = settingsOpen
  }, [refreshAccount, settingsOpen])
  const account = useAccount(state => state)
  const colorScheme = useTheme(snapshot => snapshot.active.colorScheme)
  const signedIn = account.view?.status === 'credential-stored'
  const [signInNotice, setSignInNotice] = useState(0)
  useEffect(() => subscribeModelSignInRequired?.(() => { setSignInNotice(value => value + 1) }), [subscribeModelSignInRequired])
  const [expiryNotice, setExpiryNotice] = useState(false)
  useEffect(() => subscribeSessionExpired?.(() => { setExpiryNotice(true) }), [subscribeSessionExpired])
  const profile = account.details?.profile
  const label = profile === undefined ? null : profile.status === 'ready'
    ? profile.value.name ?? profile.value.contact ?? t('signedIn') : t('signedIn')
  const [open, setOpen] = useState(false)
  const [usage, setUsage] = useState<AccountUsageOutcome>()
  // The visual summary is a menu header, which assistive technology treats as
  // outside the menu's rows; the trigger describes the same values instead.
  const summaryId = useId()
  useEffect(() => {
    if (!signedIn) { setUsage(undefined); return }
    if (!open) return
    let current = true
    // Opening the menu is the read; cleanup discards a result that settles after close.
    void readUsage().then(
      (value) => { if (current) setUsage(value ?? { status: 'failed' }) },
      () => { if (current) setUsage({ status: 'failed' }) },
    )
    return () => { current = false }
  }, [open, readUsage, signedIn])
  const trigger = useRef<HTMLButtonElement>(null)
  const [busy, setBusy] = useState(false)
  const [signOutImpact, setSignOutImpact] = useState<boolean | 'unknown'>()
  const requestSignOut = async () => {
    setBusy(true)
    try { setSignOutImpact(await hasRunningAccountTasks()); setOpen(false) }
    catch (_error) { setSignOutImpact('unknown'); setOpen(false) }
    finally { setBusy(false) }
  }
  // The plugin's start publishes `loginFailed` before it rejects, so the dialog owns the report.
  const beginSignIn = (): void => { setOpen(false); void start().catch(() => undefined) }
  return <div ref={anchor} className={css.root}>
    {signInNotice > 0 && <Toast key={signInNotice} text={t('modelSignInRequired')} onDone={() => { setSignInNotice(0) }} />}
    {expiryNotice && <Toast text={t('sessionExpired')} onDone={() => { setExpiryNotice(false) }} />}
    {signedIn && !account.desktopOnboardingVisible && !account.onboarding && account.notices && <AccountNoticeStack
      notices={account.notices}
      anchor={anchor} title={t('bonusNoticeTitle')} closeLabel={t('close')}
      onShown={bonusNoticeShown} onDismiss={bonusNoticeDismissed} />}
    {signedIn && <span id={summaryId} className={css.srOnly}>{usageDescription(usage, account.details?.balance, t)}</span>}
    <Menu open={open} side="top" portal autoFocus className={css.anchor} listClassName={signedIn ? undefined : css.signedOutMenu}
      header={signedIn ? <UsageSummary usage={usage} balance={account.details?.balance} t={t} /> : undefined}
      anchor={<button ref={trigger} type="button" className={css.trigger} data-collapsed={!wide} data-signed-out={!signedIn} aria-label={t('menu')}
        aria-haspopup="menu" aria-expanded={open} aria-describedby={signedIn ? summaryId : undefined}
        onClick={() => { if (!open) setUsage(undefined); setOpen(value => !value) }}>
        {signedIn
          ? <span className={css.avatar} data-avatar-status={account.avatar?.status}>
            <AccountAvatar avatar={account.avatar} avatarFailed={avatarFailed} />
          </span>
          : <IconEllipsisOutlineMedium size={14} />}
        {wide && <span className={css.label}>{signedIn ? label : t('more')}</span>}
      </button>}
      items={[
        { id: 'settings', label: t('settings'), icon: <IconSettingsOutlineMedium size={16} />,
          ...(settingsShortcut === undefined ? {} : { shortcut: settingsShortcut }) },
        { id: 'contact', label: t('contactUs'), icon: <IconPaperPlaneOutlineMedium size={16} /> },
        ...(signedIn ? [{ id: 'signout', label: t('signOut'), icon: <LogoutIcon />, disabled: busy }]
          : [{ id: 'signin', label: t('signIn'), icon: <IconUserOutlineMedium size={16} /> }]),
      ]}
      onClose={() => { setOpen(false) }}
      onSelect={(id) => {
        if (id === 'settings') { setOpen(false); trigger.current?.focus(); openSettings() }
        else if (id === 'contact') { setOpen(false); contactUs() }
        else if (id === 'signin') beginSignIn()
        else void requestSignOut()
      }} />
    {account.loginVisible && !account.onboarding && <SignInDialog account={account} colorScheme={colorScheme}
      start={start} cancel={cancel} t={t}
      close={() => { showLogin(false) }} useApiKey={() => { showLogin(false); openOnboarding('deepseek-official') }} />}
    {signedIn && signOutImpact !== undefined && <SignOutDialog running={signOutImpact} signOut={signOut}
      close={() => { setSignOutImpact(undefined) }} t={t} />}
  </div>
}

/** Values the pinned usage header shows for one account snapshot. */
interface UsageFacts {
  readonly quotaText: string
  readonly usedText: string
  readonly meter: ReturnType<typeof usageMeter>
}

/**
 * Derive the usage header's row text and meter.
 * @param usage - latest usage read, or undefined while pending.
 * @param balance - wallet outcome from the shared account snapshot.
 * @param t - localized account copy.
 * @returns the two row texts and the meter, or undefined when the meter has no data.
 */
function usageFacts(usage: AccountUsageOutcome | undefined, balance: AccountDetails['balance'] | undefined,
  t: AccountMenuProps['t']): UsageFacts {
  const wallets = balance?.status === 'ready' ? balance.value : undefined
  const value = usage?.status === 'ready' ? usage.value : undefined
  const quotaText = formatWallets(wallets ?? []) ?? (balance === undefined ? t('loading') : t('usageUnavailable'))
  const usedText = value === undefined
    ? (usage === undefined ? t('loading') : t('usageUnavailable'))
    : formatUsageCost(value.cost, wallets?.[0]?.currency)
  const meter = value === undefined ? undefined : usageMeter(value.cost, wallets ?? [])
  return { quotaText, usedText, meter }
}

/**
 * Accessible description for the launcher trigger: the menu's header is not one
 * of its rows, so screen readers reach these totals through the trigger instead.
 * @param usage - latest usage read, or undefined while pending.
 * @param balance - wallet outcome from the shared account snapshot.
 * @param t - localized account copy.
 * @returns localized labels joined with the same values the header shows.
 */
function usageDescription(usage: AccountUsageOutcome | undefined, balance: AccountDetails['balance'] | undefined,
  t: AccountMenuProps['t']): string {
  const { quotaText, usedText, meter } = usageFacts(usage, balance, t)
  return [
    t('usageTitle'),
    t('usagePeriod'),
    `${t('usageQuota')} ${quotaText}`,
    `${t('usageUsed')} ${usedText}`,
    meter === undefined ? '' : `${t('usageMeterLabel')} ${meter.percent}%`,
  ].filter(Boolean).join(' ')
}

/**
 * Fixed-window account usage pinned above the menu actions.
 * @param props.usage - latest usage read, or undefined while the current read is pending.
 * @param props.balance - wallet outcome from the shared account snapshot.
 * @param props.t - localized account copy.
 * @returns the usage summary, or unavailable/loading values per row.
 */
function UsageSummary({ usage, balance, t }: {
  usage: AccountUsageOutcome | undefined
  balance: AccountDetails['balance'] | undefined
  t: AccountMenuProps['t']
}) {
  const { quotaText, usedText, meter } = usageFacts(usage, balance, t)
  return <div className={css.usage} role="group" aria-label={t('usageTitle')}>
    <div className={css.usageHeading}>
      <span>{t('usageTitle')}</span>
      <span className={css.usagePeriod}>{t('usagePeriod')}</span>
    </div>
    <dl className={css.usageRows}>
      <dt>{t('usageQuota')}</dt><dd>{quotaText}</dd>
      <dt>{t('usageUsed')}</dt><dd>{usedText}</dd>
    </dl>
    {meter !== undefined && <div className={css.usageMeter} data-level={meter.level} role="progressbar"
      aria-label={t('usageMeterLabel')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={meter.percent}
      aria-valuetext={`${meter.percent}%`}>
      <div className={css.usageMeterFill} style={{ width: `${meter.percent}%` }} />
    </div>}
  </div>
}
