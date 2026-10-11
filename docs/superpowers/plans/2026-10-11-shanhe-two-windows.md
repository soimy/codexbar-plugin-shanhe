# Shanhe plugin: two usage windows + recent-usage chart

**Goal:** map the Shanhe dashboard onto CodexBar's two-window model — the 5-hour period
(`primary`) and the natural-month allowance (`secondary`) — so the provider card shows two
progress bars, the menu bar / Overview icon can follow either window, and the card gains a
recent-usage bar chart.

**Status:** the two windows and the `icon` are implemented and verified (§7.1, §7.2); the
recent-usage chart still needs one authenticated `get_daily_stats` sample (see §6).

**Progress**

- [x] Step 1 — parser: both allowance pairs + countdown → `resetsAt`.
- [x] Step 2 — snapshot: `primary` (5h, 300 min), `secondary` (month, 43,200 min), details, `icon`.
- [x] Step 3 — `check.mjs` rewritten for both windows + a missing-pair negative case.
- [x] Step 4 — real-engine repro passes on QuickJS (and JavaScriptCore).
- [ ] Step 5 — chart: blocked on the `get_daily_stats` shape.

---

## 0. Verified host behaviour (CodexBar 0.73.0)

Read from the shipped app and upstream sources, not from guesses:

| Surface | What the host does | Source |
| --- | --- | --- |
| User-plugin card | Renders exactly `primary`, `secondary`, `tertiary`, each as a percent line + progress bar. Titles are **hard-coded** `"Primary" / "Secondary" / "Tertiary"`. | `Sources/CodexBar/StatusItemController+UserPlugins.swift:231-233, 287-305` |
| `extraWindows` | Mapped into the snapshot but **not rendered in the user-plugin card**. Do not rely on them for display. | same file |
| Bar text | `UsageFormatter.usageLine(remaining:used:showUsed:)` → e.g. `75% left`; follows the global "show used" preference. | `Sources/CodexBarCore/UsageFormatter.swift:95-101` |
| `resetDescription` | Not shown on the plugin card; feeds menu-bar/reset text. | `Sources/CodexBar/MenuBarDisplayText.swift:178-181` |
| Details + chart | `ProviderDetailSectionsContent(sections:chartColor:)` renders detail rows **and** `chart` (bars/line, ≤120 points) under the bars. | `StatusItemController+UserPlugins.swift:243-246` |
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
- **`请求次数余额 1,567 / 1800` is the current (5-hour) window**: remaining 1,567 of the per-period
  limit 1,800 → used 233 → **12.9%**.
- The monthly window is the page's `本周期剩余 R / 每月上限 M 次` pair.
- `dashboard.php` stays the source for the windows; `user_api.php` supplies the usage records (§5).
- `fixtures/dashboard.html` is stale (`请求次数余额 3`, `每期1,800次`; the real line is
  `请求次数余额 1,567 / 1800`) and must be rewritten as part of the change.

## 2. Snapshot design

```js
return {
  primary: {                        // 5-hour period — drives the tray/Overview icon by default
    usedPercent: pct(periodLimit - periodRemaining, periodLimit),
    windowMinutes: 300,
    resetsAt: now + countdownMs,    // from "X小时Y分钟后重置"
    resetDescription: `${periodRemaining} / ${periodLimit} left`,
  },
  secondary: {                      // natural-month allowance — selectable as menu-bar metric
    usedPercent: pct(monthLimit - monthRemaining, monthLimit),
    windowMinutes: 43200,           // 30 days, the value official monthly plugins use
    resetDescription: "Resets on the 1st",   // no invented resetsAt; the page gives no monthly time
  },
  details: [
    { title: "Usage windows", rows: [ /* "5-hour period", "This month" with used/limit */ ] },
    { title: "Recent usage", rows: [ /* day count + total */ ],
      chart: { kind: "bars", title: "Requests per day", unit: "requests",
               points: [ /* ≤120 {label, value} */ ] } },
  ],
  identity: { loginMethod: "Browser session" },
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

Plan:

1. Fetch the period/month page and the records page in one round trip with
   `ctx.http.getWithOptional(...)`, the documented "required + optional enrichment" pair (Abacus and
   Sakana use it). Records are **optional**: a failure keeps both windows and just drops the chart.
2. Aggregate records into buckets (day first; fall back to hour if the window is short), cap at 120
   points, and label them `YYYY-MM-DD`.
3. Bound the work: `page_size` is the only knob; keep the response under the 1 MiB cap and the
   whole fetch under the 20 s watchdog. If a record page is large, request one page and chart what
   fits rather than paginating unbounded.
4. If the sample shows a different envelope (e.g. `data.records` with `created_at` / `count` /
   `model`), the parser targets those exact fields — no multi-shape guessing.

## 6. Recent-usage chart — remaining unknown

The observed `get_usage_records` page is a newest-first request log (`data.list[]` with
`request_time`, `requests_deducted`, `total_tokens`, `model`, …), only 20 records per page against a
`total` of ~59.5k, so it cannot cover days: two sample records sit 23 seconds apart. A second action
was found by probing the endpoint (an unauthenticated call answers `未登录` for a valid action and
`无效的请求` for an unknown one): **`get_daily_stats`** — which is the natural daily series for the
chart, alongside `get_api_keys`.

Still needed: the authenticated body of

```
https://api.0ki.cn/user_api.php?action=get_daily_stats
```

It fixes the envelope, the bucket field (date), and the per-bucket value (requests vs tokens vs
cost). Then the chart is a second, **optional** request on the same origin (paths are not part of the
approval binding, so no re-approval):

1. Fetch `dashboard.php` and `get_daily_stats` in one round trip with `ctx.http.getWithOptional(...)`
   — records are optional, so a failure keeps both windows and only drops the chart.
2. Bucket by day, cap at 120 points, label `YYYY-MM-DD`, and keep the response under the 1 MiB cap.
3. No multi-shape guessing: target the exact fields from the sample.

## 7. Verification

1. `node check.mjs` — rewrite the fixture to the real shape, extend the stub with any new member
   (`format`, `date.nowMillis`, `http.getWithOptional`), and assert: 12.9% primary, the monthly
   percentage, the countdown → `resetsAt`, chart point count, and that a missing label still throws.
   Keep the `acceptCookie` stub throwing.
2. `tools/repro/repro.sh --expect-ok`, plus one run with `CODEXBAR_PLUGIN_ENGINE=jsc`, to prove the
   snapshot passes the real mapper (the check stub cannot catch host-side contracts).
3. Install, `diff shanhe.js ~/.config/codexbar/providers/shanhe.js`, refresh CodexBar, and confirm in
   the app: two bars, the chart, `Menu bar metric` offering Secondary, and the monogram in the
   switcher/Overview.
4. Update `AGENTS.md` (data flow, error ladder note about the second request) and `README.md`
   (visible fields) in the same change.

## 8. Ordering

1. Capture the one JSON sample (§6) and rewrite `fixtures/dashboard.html` from the real page.
2. Parser: both windows + countdown.
3. Snapshot: `primary` / `secondary` / details / `icon`.
4. Chart: `getWithOptional` + bucketed points.
5. Tests (§7.1) → real-engine repro (§7.2) → install + app check (§7.3) → docs (§7.4).
