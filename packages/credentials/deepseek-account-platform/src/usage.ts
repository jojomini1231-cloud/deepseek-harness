/** Platform usage-window queries and totals for the account menu. */
import { z } from 'zod'
import type { AccountUsage, AccountUsageCost, AccountUsageOutcome } from '@deepseek-ai/dsh-deepseek-account/types'
import { AccountUnauthorizedError, PlatformAuthError, requestUsage } from './protocol.ts'
import { platformDecimal } from './decimal.ts'

const DAY_SECONDS = 86_400

const costValue = z.union([z.string().regex(platformDecimal), z.number()])
const costSeries = z.object({ buckets: z.array(z.object({ cost: costValue })) })
const costPayload = z.object({
  data: z.array(z.object({
    currency: z.enum(['CNY', 'USD']),
    series: z.array(costSeries),
    function_series: z.array(costSeries),
  })),
})

/**
 * Compute the Platform usage window for one local UTC offset. The window covers
 * the caller's current local day; the bucketing offset is Platform's whole-hour
 * form of that offset.
 * @param nowSeconds - current epoch seconds.
 * @param offsetSeconds - UI offset east of UTC in seconds.
 * @returns inclusive start, exclusive end, and whole-hour bucketing offset.
 */
export function usageWindow(nowSeconds: number, offsetSeconds: number): { start: number; end: number; tz: number } {
  const tz = 3600 * Math.floor(offsetSeconds / 3600)
  const today = Math.floor((nowSeconds + offsetSeconds) / DAY_SECONDS)
  const start = today * DAY_SECONDS - offsetSeconds
  return { start, end: start + DAY_SECONDS, tz }
}

/**
 * Sum the account-wide Platform cost response.
 * @param value - `/api/v0/usage/by_api_key/cost` business payload.
 * @returns per-currency consumption over the reporting window.
 * @throws PlatformAuthError when the payload does not match the endpoint schema.
 */
export function summarizeUsageCost(value: unknown): AccountUsage {
  const spent = decode(costPayload, value, 'usage-cost')
  const totals = new Map<'CNY' | 'USD', number>()
  for (const row of spent.data) {
    let total = totals.get(row.currency) ?? 0
    for (const series of [...row.series, ...row.function_series]) {
      for (const bucket of series.buckets) total += Number(bucket.cost)
    }
    totals.set(row.currency, total)
  }
  const cost: AccountUsageCost[] = [...totals].map(([currency, value]) => ({ currency, amount: decimal(value) }))
  return { cost }
}

/**
 * Read the account's usage cost for the caller's current local day.
 * @param origin - configured origin matching the stored grant issuer.
 * @param token - stored account grant.
 * @param offsetSeconds - UI offset east of UTC in seconds.
 * @param signal - credential lifetime; each Platform request also gets its own timeout.
 * @param timeoutMs - deadline for each Platform HTTP request.
 * @param headers - deployment and client identity headers for this origin.
 * @returns the summed usage outcome; non-authorization failures produce a failed outcome.
 * @throws AccountUnauthorizedError when Platform rejects the stored token.
 */
export async function readAccountUsage(origin: string, token: string, offsetSeconds: number,
  signal: AbortSignal, timeoutMs: number, headers: Record<string, string>): Promise<AccountUsageOutcome> {
  const window = usageWindow(Date.now() / 1000, offsetSeconds)
  try {
    const cost = await requestUsage(origin, window, token, requestSignal(signal, timeoutMs), headers)
    return { status: 'ready', value: summarizeUsageCost(cost) }
  } catch (error) {
    if (error instanceof AccountUnauthorizedError) throw error
    return { status: 'failed' }
  }
}

/** Combine the credential lifetime with a fresh deadline for one Platform HTTP request. */
function requestSignal(lifetime: AbortSignal, timeoutMs: number): AbortSignal {
  return AbortSignal.any([lifetime, AbortSignal.timeout(timeoutMs)])
}

function decode<T>(schema: z.ZodType<T>, value: unknown, field: 'usage-cost'): T {
  const parsed = schema.safeParse(value)
  if (!parsed.success) {
    console.error('[deepseek-account] usage schema rejected', {
      field, issues: parsed.error.issues.map(issue => ({ path: issue.path, code: issue.code })),
    })
    throw new PlatformAuthError('protocol')
  }
  return parsed.data
}

/**
 * Render one aggregated amount as a Platform decimal string.
 * @param value - summed cost; aggregate overflow is a protocol failure.
 * @returns fixed-point text without trailing zeros, or JavaScript's exponent text for very large values.
 * @throws PlatformAuthError when the sum is not finite.
 */
function decimal(value: number): string {
  if (!Number.isFinite(value)) throw new PlatformAuthError('protocol')
  const fixed = value.toFixed(12)
  // toFixed returns exponent notation at or above 1e21; trimming trailing zeros would corrupt the exponent.
  if (/[eE]/.test(fixed)) return fixed
  const trimmed = fixed.replace(/\.?0+$/, '')
  return trimmed === '-0' ? '0' : trimmed
}
