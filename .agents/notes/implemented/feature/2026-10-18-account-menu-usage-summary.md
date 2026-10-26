# Agent Note: Account-menu usage summary

Status: implemented

English | [中文](2026-10-18-account-menu-usage-summary.zh.md)

## Problem

The sidebar account menu answered “who am I signed in as” and offered sign-out, but the recharge balance and today's consumed amount a signed-in user checks most often lived only on Platform's Usage page. Opening that page leaves the GUI, and its date filter and export controls are unnecessary for a quick account check.

## Decision

The account capability gains `getUsage(client)`, exposed through `AccountController` as `account/getUsage`. One Host call reads Platform's `usage/by_api_key/cost` endpoint. The usage window covers the caller's current local day, computed from the full `AccountClientMetadata.timezoneOffsetSeconds`; the query reports that offset's whole-hour form as `tz`, the bucketing zone Platform's Usage page uses. The Host sums per-currency cost from both the model `series` and the tool-call `function_series`, across every API key in the account. The query is not filtered to the DeepSeek Harness key: the consumed amount is an account fact, and filtering it to one key hid usage that Platform reported for another key. A failed usage response yields no partial totals; the quota row keeps using the recharge balance from the shared account-detail snapshot, refreshed on sign-in and each Settings entry.

The signed-in `AccountMenu` pins a Usage header above its actions through a new non-interactive `Menu.header` prop. Each open starts a fresh read: the header resets to Loading before the response paints, never shows a previous opening's totals, and shows Unavailable on failure without hiding the menu actions. Because the pinned header sits outside the menu's row keyboard walk, the launcher also exposes the same totals in an accessible description that assistive technology reads without entering menu mode. Costs use the existing balance formatter, the account's wallet currency when Platform reports no cost rows, and a symbol-free zero when no wallet currency is known. A meter below the two rows fills to today's consumed share of the day's starting balance (the remaining balance plus the consumed amount): success through 50%, warning through 80%, and error above 80%, measured from the displayed percentage so the color and the announced value agree; it is hidden when no matching wallet or amount exists. There is no date filter or export. Closing the menu discards a read still in flight, and sign-out clears the retained outcome. A fixed UTC offset cannot express a daylight-saving day, so a 23- or 25-hour local day is queried as a 24-hour window.

## Alternatives considered

**Reuse the embedded Platform Usage page.** It already renders the same totals, but only after leaving the menu; the point of this change is a one-glance check. **Rejected** as the only surface.

**Derive totals from local Session token usage.** DSH already records token usage, but those records describe this installation's Sessions, not the whole Platform account across API keys, tools, and other clients. **Rejected** as a different quantity.

**Return raw usage series and aggregate in the browser.** This would push per-key, per-model, per-bucket rows through the Remote and duplicate Platform's fold in the client. The Host already holds the credential and can sum once. **Rejected**.

**Filter usage to the DeepSeek Harness API key.** This matched one earlier Platform screenshot but hid today's consumption when another API key incurred it, showing 0 beside a Platform value of 0.11. **Rejected**: the menu's consumed amount is account-wide.

**Add the Usage page's date filter and export.** Both need additional state, copy, and layout in a compact balance-and-consumption popover; Platform's page remains the full tool. **Rejected** as out of scope.

## Consequences

Opening the signed-in menu issues one Host usage read backed by one Platform cost request, so the menu has a loading and failure state of its own. No totals are cached across openings, and a closed or superseded read cannot update the header. Closing the menu does not cancel the Host request: the Remote call carries no cancellation signal, so the Platform reads finish and only their result is discarded. The account service, Remote typings, generated Cordis catalog, and the primitive's documented `header` surface all change together. The menu remains usable while usage is unavailable, and the account token never reaches the renderer.

## Testing

`usage.spec.ts` pins whole-hour, fractional and negative-offset windows including local midnight, multi-currency and zero-row cost, decimal normalization at the big.js exponent boundary, and malformed payloads. The provider suite covers a successful account-wide read with its query parameters and client identity headers, a usage report above the account-detail size cap, credential rejection through both HTTP 401 and business code 40003, malformed cost payloads, signed-out reads, an in-flight credential replacement, and a late rejection that must not clear the replacement credential. Controller tests pin delegation. The account UI suite covers formatted cost, the usage meter and its rounding thresholds, Loading on every open including a second open, Unavailable, zero cost in the wallet currency, the symbol-free zero without a wallet currency, the trigger's accessible description, and reads that settle after the menu closes; the primitives suite pins the pinned `header` outside the row keyboard walk. Focused coverage remains 100% per source file.
