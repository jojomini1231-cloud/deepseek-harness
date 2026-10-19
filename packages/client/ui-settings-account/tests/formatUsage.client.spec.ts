/** Account menu cost and meter formatting. */
import { expect, it } from 'vitest'
import { formatUsageCost, formatWallets, usageMeter } from '../src/client/formatUsage.ts'

it('joins per-currency costs and shows a bare zero when no wallet currency is known', () => {
  expect(formatUsageCost([{ currency: 'CNY', amount: '11.94' }, { currency: 'USD', amount: '2' }], 'CNY'))
    .toBe('¥11.94 · $2.00')
  expect(formatUsageCost([], 'CNY')).toBe('¥0.00')
  expect(formatUsageCost([], 'USD')).toBe('$0.00')
  // A failed or pending wallet read must not invent a currency symbol.
  expect(formatUsageCost([])).toBe('0.00')
  expect(formatUsageCost([], undefined)).toBe('0.00')
})

it('joins wallet balances and omits an empty wallet list', () => {
  expect(formatWallets([{ currency: 'CNY', balance: '1234.56000000' }, { currency: 'USD', balance: '0.00000100' }]))
    .toBe('¥1,234.56 · <$0.01')
  expect(formatWallets([])).toBeUndefined()
})


it.each([
  ['100', '0', 'success', 0],
  ['100', '50', 'success', 50],
  ['100', '50.05', 'success', 50],
  ['100', '50.1', 'warn', 50.1],
  ['100', '80', 'warn', 80],
  ['100', '80.04', 'warn', 80],
  ['100', '80.1', 'error', 80.1],
  ['100', '150', 'error', 100],
  ['0', '0', 'success', 0],
  ['0', '1', 'error', 100],
])('maps balance %s and used %s to a %s meter at %s percent', (balance, used, level, percent) => {
  expect(usageMeter([{ currency: 'CNY', amount: used }], [{ currency: 'CNY', balance }]))
    .toEqual({ level, percent })
})

it('derives a zero meter from an empty cost report and hides when no amount matches', () => {
  expect(usageMeter([], [{ currency: 'CNY', balance: '10' }])).toEqual({ level: 'success', percent: 0 })
  expect(usageMeter([], [])).toBeUndefined()
  expect(usageMeter([{ currency: 'USD', amount: '1' }], [{ currency: 'CNY', balance: '10' }])).toBeUndefined()
  expect(usageMeter([{ currency: 'USD', amount: '1' }],
    [{ currency: 'CNY', balance: '10' }, { currency: 'USD', balance: '10' }])).toBeUndefined()
})
