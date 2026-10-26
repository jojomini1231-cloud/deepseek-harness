/** Account menu cost, wallet, and usage-meter formatting. */
import { Big } from 'big.js'
import type { AccountUsageCost, AccountWallet } from '@deepseek-ai/dsh-deepseek-account/types'
import { formatBalance } from './formatBalance.ts'

/**
 * Format per-currency consumption; an empty report shows zero, with the wallet
 * currency when one is known.
 * @param cost - consumed amounts reported by Platform.
 * @param fallback - currency to use when Platform reported no cost rows; omitted when no wallet currency is known.
 * @returns one formatted amount per currency, joined for the menu row.
 */
export function formatUsageCost(cost: readonly AccountUsageCost[], fallback?: 'CNY' | 'USD'): string {
  if (cost.length === 0) return fallback === undefined ? '0.00' : formatAmount(fallback, '0')
  return cost.map(item => formatAmount(item.currency, item.amount)).join(' · ')
}

/** Severity of today's consumption relative to the remaining balance. */
export type UsageMeterLevel = 'success' | 'warn' | 'error'
/** Progress-bar facts for today's consumption against the remaining balance. */
export interface UsageMeter {
  /** Clamped share of the balance already consumed, as a percentage with one decimal place. */
  readonly percent: number
  readonly level: UsageMeterLevel
}

/**
 * Derive the account menu's usage meter from the first wallet and its matching cost row.
 * The meter measures consumed amount as a share of the remaining balance; severity follows
 * the rounded percentage: up to 50% is `success`, up to 80% is `warn`, and anything above is
 * `error`, so the bar color and `aria-valuenow` always agree.
 * @param cost - consumed amounts reported by Platform.
 * @param wallets - recharge wallet balances from Platform.
 * @returns the clamped percentage and severity, or undefined when no matching amount exists.
 */
export function usageMeter(cost: readonly AccountUsageCost[], wallets: readonly AccountWallet[]): UsageMeter | undefined {
  const wallet = wallets[0]
  if (wallet === undefined) return undefined
  const reported = cost.length === 0 ? '0' : cost.find(item => item.currency === wallet.currency)?.amount
  if (reported === undefined) return undefined
  const used = new Big(reported)
  const total = new Big(wallet.balance).plus(used)
  const ratio = total.lte(0) ? new Big(0) : used.div(total)
  const percent = Math.round(Math.min(1, Math.max(0, ratio.toNumber())) * 1000) / 10
  const level = percent <= 50 ? 'success' : percent <= 80 ? 'warn' : 'error'
  return { percent, level }
}

/**
 * Format recharge wallets for one menu row.
 * @param wallets - recharge wallet balances from Platform.
 * @returns joined amounts, or undefined when Platform reported no wallet.
 */
export function formatWallets(wallets: readonly AccountWallet[]): string | undefined {
  return wallets.length === 0 ? undefined : wallets.map(wallet => formatAmount(wallet.currency, wallet.balance)).join(' · ')
}

function formatAmount(currency: 'CNY' | 'USD', amount: string): string {
  return formatBalance(amount, currency === 'CNY' ? '¥' : '$')
}
