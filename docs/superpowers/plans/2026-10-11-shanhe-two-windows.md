# Shanhe plugin: two usage windows + recent-usage chart

**Goal:** map the Shanhe dashboard onto CodexBar's two-window model — the 5-hour period
(`primary`) and the natural-month allowance (`secondary`) — so the provider card shows two
progress bars, the menu bar / Overview icon can follow either window, and the card gains a
recent-usage bar chart.

**Status:** done — the two windows, the `icon`, and the recent-usage chart are implemented and
verified (§7.1, §7.2). The chart reads `get_usage_records`; `get_daily_stats` turned out not to be
needed (§5).

**Progress**

- [x] Step 1 — parser: both allowance pairs + countdown → `resetsAt`.
- [x] Step 2 — snapshot: `primary` (5h, 300 min), `secondary` (month, 43,200 min), details, `icon`.
- [x] Step 3 — `check.mjs` rewritten for both windows + a missing-pair negative case.
- [x] Step 4 — real-engine repro passes on QuickJS (and JavaScriptCore).
- [x] Step 5 — chart: hourly buckets from `get_usage_records`, optional request, degraded paths tested.

---

## 0. Verified host behaviour (CodexBar 0.74.0)

Read from the shipped app and upstream sources, not from guesses:

| Surface | What the host does | Source |
| --- | --- | --- |
| User-plugin card | Renders exactly `primary`, `secondary`, `tertiary`, each as a percent line + progress bar. Titles are **hard-coded** `"Primary" / "Secondary" / "Tertiary"`. | `Sources/CodexBar/StatusItemController+UserPlugins.swift:231-233, 287-305` |
| `extraWindows` | Mapped into the snapshot but **not rendered in the user-plugin card**. Do not rely on them for display. | same file |
| Bar text | `UsageFormatter.usageLine(remaining:used:showUsed:)` → e.g. `75% left`; follows the global "show used" preference. | `Sources/CodexBarCore/UsageFormatter.swift:95-101` |
| `resetDescription` | Not shown on the plugin card; feeds menu-bar/reset text. | `Sources/CodexBar/MenuBarDisplayText.swift:178-181` |
| Details + chart | `ProviderDetailSectionsContent(sections:chartColor:)` renders detail rows **and** `chart` (bars/line, ≤120 points) under the bars. Bars carry no axis labels — `label` reaches VoiceOver only. | `StatusItemController+UserPlugins.swift:243-246`, `ProviderDetailSectionsContent.swift:103-121,158-163` |
| Menu bar / tray percent | `MenuBarMetricWindowResolver.rateWindow(...)`: `.automatic` → `primary ?? secondary ?? tertiary`; the user may pick Primary / Secondary / Tertiary / Average (`Average` needs **both** primary and secondary) / Extra usage. | `Sources/CodexBar/MenuBarMetricWindowResolver.swift:39-64, 90-105` |
| Overview / merged icons | Same resolver per provider row; the plugin switcher segment uses the manifest icon (monogram + tint). | `Sources/CodexBar/StatusItemController+SwitcherViews.swift:72-76` |
| Icon | `icon: {monogram, tint}` drives the switcher badge, the card accent and the chart colour. Omitted → first letter + neutral tint. | `StatusItemController+UserPlugins.swift:208-212, 307-314` |

Consequence: **`primary` = the 5-hour window, `secondary` = the monthly window.** That alone gives
`Automatic`/`Primary`, `Secondary` and `Average` in the menu-bar metric picker, with no manifest
change and no re-approval.

## 1. Account semantics (confirmed by the account owner)

- **One period = 5 hours.** The vendor store lists the same shape for every CodingPlan tier
  (星尘 325/4,875 · 星河 753/11,300 · 星海 1,493/22,400 · 星辰 3,033/45,500), each "每 5 小时 N 次 +
  每月上限 M 次 + 自然月重置".
- **Limits come from the page, never hard-coded:** this account is 每期 1,800 次 / 每月 30,000 次, and
  other tiers differ.
- **The current (5-hour) window** is the bare `请求次数余额` stat (`<p class="stat-value">1,796</p>`);
  its cap is `每期1,800次` in the VIP block, not a second number on the same line. The owner's
  earlier paraphrase (`请求次数余额 1,567 / 1800`) is what the first parser wrongly required, and
  building a fixture from that paraphrase is what caused the "missing period allowance" failure.
- The monthly window is the page's `本周期剩余 R / 每月上限 M 次` pair.
- `dashboard.php` stays the source for the windows; `user_api.php` supplies the usage records (§5).
- The window labels shown in the card are Chinese, written into the plugin: the host does not
  localize user-plugin detail strings, and `ctx.env` exposes only `timeZone` (no locale), so there is
  no runtime language detection to hook into.

## 2. Snapshot design (as shipped)

```js
return {
  primary: {                        // 5-hour period — drives the tray/Overview icon by default
    usedPercent: pct(periodUsed, perPeriod),
    windowMinutes: 300,
    resetsAt: now + countdownMs,    // from "X小时Y分钟后重置"
    resetDescription: `${periodRemaining} / ${perPeriod} 剩余 · ${label} 后重置`,
  },
  secondary: {                      // natural-month allowance — selectable as menu-bar metric
    usedPercent: pct(monthUsed, monthLimit),
    windowMinutes: 43200,           // 30 days, the value official monthly plugins use
    resetDescription: "随自然月重置",   // no invented resetsAt; the page gives no monthly time
  },
  details: [
    { title: "用量窗口", rows: [ /* "5小时周期", "本月", "周期重置", "月度重置" */ ] },
    { title: "账户", rows: [ /* balance, billed requests, tokens, plan, concurrency, expiry */ ] },
    { title: "最近用量", rows: [ /* 统计范围 / 区间请求 / 峰值小时 */ ],
      chart: { kind: "bars", title: "每小时请求数", unit: "次",
               points: [ /* ≤120 hourly {label, value} */ ] } },
  ],
  identity: { loginMethod: "浏览器会话" },
  dataConfidence: "exact",
};
```

Rules to keep:

- Emit a window only when its numbers parse; never fabricate `usedPercent: 0` for a missing window
  (upstream convention: "absent is not zero").
- `usedPercent` is **used**, not remaining; `ctx.pct` clamps to 0–100.
- `windowMinutes` must be a positive integer (300 / 43200).
- The monthly window gets no `resetsAt`: the page reports no monthly countdown, and inventing one
  would be wrong. `resetDescription` + a detail row carry the wording.
- Detail strings ≤120 chars, ≤24 rows/section, ≤8 sections, ≤120 chart points.
- Numbers via `ctx.format.number` (no `Intl` under QuickJS).

## 3. Parser changes

```
请求次数余额\s*([\d,]+)\s*/\s*([\d,]+)      → period remaining / period limit   (primary)
每期\s*([\d,]+)\s*次                        → cross-check the period limit
本周期剩余\s*([\d,]+)\s*/\s*([\d,]+)\s*次   → month remaining / month limit     (secondary)
每月\s*([\d,]+)\s*次                        → cross-check the monthly limit
((\d+)天)?\s*((\d+)小时)?\s*((\d+)分钟)?\s*后重置 → countdown for primary resetsAt
```

- Keep `dashboardNumber`'s throw-on-missing behaviour; a missing period or month pair is a parse
  failure, not a silent zero.
- Guard `remaining ≤ limit`, `limit > 0` for both windows.
- The parser is pure; `fetchUsage` still owns HTTP classification (error ladder unchanged).

## 4. Manifest changes (approval-safe)

```js
icon: { monogram: "SH", tint: "#0F766E" },   // switcher badge, card accent, chart colour
```

- Adding `icon` does not touch the approval binding (`id / endpoints / auth / capabilities /
  cookieDomains / secure settings`). `settings` stays empty, no new capability, no re-approval.
- Bar titles stay "Primary"/"Secondary" (host-hard-coded), so the human-readable window names live
  in the `Usage windows` detail section.

## 5. Recent-usage chart

Confirmed endpoint (same origin, so **no approval change** — the binding pins origins, not paths):

```
GET https://api.0ki.cn/user_api.php?action=get_usage_records&page=1&page_size=N
```

Verified unauthenticated: `HTTP 200`, `application/json`, body `{"success":false,"message":"未登录"}`
(so it needs the session cookie, and `get_balance` is rejected as `无效的请求` — actions are
allowlisted server-side).

### What the authenticated sample showed (captured 2026-10-11)

Envelope `{success, data: {list, total, page, page_size}}`; records newest-first, each with
`id, model, input_tokens, output_tokens, total_tokens, cache_tokens, response_time, first_byte_ms,
amount, requests_deducted, request_count, model_ratio, time_ratio, context_tier_ratio, final_ratio,
request_time`. `requests_deducted` is a decimal **string** and is the billed count that consumes the
allowance; it matches `request_count` except for the rare unbilled row.

Measured limits: `page`/`page_size` are the only parameters (`date`, `start_date`, `end_date`,
`days`, `granularity`, `group_by` are all ignored), `page_size` is honoured well past 1,500
(`page_size=5000` answered 1.86 MB), and one record is ~373 bytes. The host caps a user plugin's
response at **1 MiB**, so `page_size=1500` (560 KB, ~0.6 s, ~28 h of history) is the practical
ceiling. **Daily buckets are impossible**: a week of records is several MiB. The chart is hourly,
which also matches the 5-hour `primary` window.

### Implemented

1. One round trip: `ctx.http.getWithOptional(dashboard, records, {headers})`; the log arrives under
   `.optional` and is `null` on failure, timeout, or oversize.
2. `recentUsage` buckets by `request_time`'s hour on the vendor's clock (integer civil-date maths —
   no `Date`, no `Intl`), sums `requests_deducted`, fills quiet hours with zero, drops the partial
   oldest hour the page boundary created, and keeps the newest 120 points.
3. Chart problems can never fail the fetch: `recentUsage` returns `null` instead of throwing, and the
   call site catches anyway.
4. `fixtures/records.json` is a real 210-record excerpt (including a real three-hour silence) so the
   zero-fill and partial-hour rules stay tested.

### Superseded

`get_daily_stats` is **not used**. It was the planned daily series, but the daily chart is impossible
under the 1 MiB cap, and the owner asked for the chart to come from `get_usage_records`.

## 7. Verification (as shipped)

1. `node check.mjs` — the stub serves the required dashboard plus the optional records payload and
   asserts: primary 0.22% and its `resetsAt` from the countdown, the monthly percentage, both
   `windowMinutes`, the row labels, the chart's five points (`10-11 15:00 … 19:00` with three zero
   bars), its range/total/peak rows, the 120-point cap, that a missing allowance block still throws,
   and that a `null`, non-JSON, or reshaped records payload drops only the chart. The `acceptCookie`
   stub still throws on purpose.
2. `tools/repro/repro.sh --expect-ok` on QuickJS and with `CODEXBAR_PLUGIN_ENGINE=jsc`: both engines
   fetch the two URLs with the same cookie and map the chart through the real snapshot validator.
3. `shanhe.js` copied to `~/.config/codexbar/providers/shanhe.js` and verified with `diff`. The app
   then shows two bars, the chart, `Menu bar metric` offering Secondary, and the monogram in the
   switcher/Overview.
4. `AGENTS.md` (layout, data flow, chart rules) and `README.md` (visible fields) updated in the same
   change.

## 8. Ordering (as shipped)

1. Capture the real dashboard and a real `get_usage_records` page; keep both as fixtures.
2. Parser: both windows + countdown.
3. Snapshot: `primary` / `secondary` / details / `icon`.
4. Chart: `getWithOptional` + hourly buckets + the degraded paths.
5. Tests (§7.1) → real-engine repro (§7.2) → install (§7.3) → docs (§7.4).
