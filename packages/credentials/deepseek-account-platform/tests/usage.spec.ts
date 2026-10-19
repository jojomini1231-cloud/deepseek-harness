/** Platform usage window and aggregation. */
import { expect, it } from 'vitest'
import { PlatformAuthError } from '../src/protocol.ts'
import { dshTrackingId, summarizeUsageCost, usageWindow } from '../src/usage.ts'

const now = Date.UTC(2026, 9, 18, 3, 44, 20) / 1000

it.each([
  [0, Date.UTC(2026, 9, 18) / 1000, Date.UTC(2026, 9, 19) / 1000, 0],
  [28_800, Date.UTC(2026, 9, 18) / 1000 - 28_800, Date.UTC(2026, 9, 19) / 1000 - 28_800, 28_800],
  [19_800, Date.UTC(2026, 9, 18) / 1000 - 19_800, Date.UTC(2026, 9, 19) / 1000 - 19_800, 18_000],
  [20_700, Date.UTC(2026, 9, 18) / 1000 - 20_700, Date.UTC(2026, 9, 19) / 1000 - 20_700, 18_000],
  [-18_000, Date.UTC(2026, 9, 17) / 1000 + 18_000, Date.UTC(2026, 9, 18) / 1000 + 18_000, -18_000],
])("covers the caller's current local day at offset %s", (offset, start, end, tz) => {
  expect(usageWindow(now, offset)).toEqual({ start, end, tz })
})

it("starts the window at the caller's exact local midnight", () => {
  const midnight = Date.UTC(2026, 9, 17, 18, 30) / 1000
  expect(usageWindow(midnight, 19_800)).toEqual({ start: midnight, end: midnight + 86_400, tz: 18_000 })
})

it('sums per-currency cost across series and tool calls', () => {
  const cost = {
    data: [
      { currency: 'CNY',
        series: [{ buckets: [{ time: 1, cost: '0.001' }, { time: 2, cost: 0.004 }] }],
        function_series: [] },
      { currency: 'USD', series: [], function_series: [{ buckets: [{ time: 1, cost: '5' }] }] },
    ],
  }
  expect(summarizeUsageCost(cost)).toEqual({
    cost: [{ currency: 'CNY', amount: '0.005' }, { currency: 'USD', amount: '5' }],
  })
})

it('reports zero cost with no rows', () => {
  expect(summarizeUsageCost({
    data: [{ currency: 'CNY', series: [], function_series: [] }],
  })).toEqual({ cost: [{ currency: 'CNY', amount: '0' }] })
})

it.each([
  ['1e30', '1e+30'],
  ['1e-13', '0'],
  ['-1e-13', '0'],
  ['0.005', '0.005'],
  ['5', '5'],
  ['0', '0'],
])('renders cost %s as the decimal amount %s', (cost, amount) => {
  expect(summarizeUsageCost({
    data: [{ currency: 'CNY', series: [{ buckets: [{ cost }] }], function_series: [] }],
  })).toEqual({ cost: [{ currency: 'CNY', amount }] })
})

it('rejects a cost total that overflows to a non-finite number', () => {
  expect(() => summarizeUsageCost({
    data: [{ currency: 'CNY', series: [{ buckets: [{ cost: '1e999' }] }], function_series: [] }],
  })).toThrow(PlatformAuthError)
})

it.each([
  [{ api_keys: [{ tracking_id: 'older', key_type: 'DSH', created_at: 1 },
    { tracking_id: 'newer', key_type: 'DSH', created_at: 2 }] }, 'newer'],
  [{ api_keys: [{ tracking_id: 'newer', key_type: 'DSH', created_at: 2 },
    { tracking_id: 'older', key_type: 'DSH', created_at: 1 }] }, 'newer'],
  [{ api_keys: [{ tracking_id: 'fallback', key_type: 'DSH' }] }, 'fallback'],
  [{ api_keys: [{ tracking_id: 'normal', key_type: 'NORMAL', created_at: 2 }] }, undefined],
  [{ api_keys: [{ tracking_id: null, key_type: 'DSH', created_at: 2 }] }, undefined],
  [{ api_keys: [] }, undefined],
])('selects the newest Harness key tracking id when one exists', (apiKeys, expected) => {
  expect(dshTrackingId(apiKeys)).toBe(expected)
})

it('rejects a malformed API key list before querying usage', () => {
  expect(() => dshTrackingId({ api_keys: [{ tracking_id: 1, key_type: 'DSH' }] })).toThrow(PlatformAuthError)
  expect(() => dshTrackingId({ api_keys: 'invalid' })).toThrow(PlatformAuthError)
})

it.each([
  { data: [{ currency: 'EUR', series: [], function_series: [] }] },
  { data: [{ currency: 'CNY', series: [{ buckets: [{ cost: 'free' }] }], function_series: [] }] },
])('rejects a malformed cost payload before reporting totals', (cost) => {
  expect(() => summarizeUsageCost(cost)).toThrow(PlatformAuthError)
})
