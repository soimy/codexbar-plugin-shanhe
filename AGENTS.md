# Repository Guidelines

Third-party CodexBar user plugin for Shanhe (`api.0ki.cn`). The plugin is one JavaScript file with no build step, no dependencies, no CI; the only extra tooling is the optional real-engine harness in `tools/repro/`.

## Layout

- `shanhe.js` — the entire plugin: `normalizeDashboard` / `dashboardNumber` / `dashboardAllowances` / `dashboardCountdown` / `parseDashboard` for the dashboard, `daysFromCivil` / `civilFromDays` / `logHour` / `hourLabel` / `recentUsage` for the chart, plus exactly one `defineProvider({...})` call. No imports, no modules, no shared state outside the fetch.
- `check.mjs` — the only check. Loads `shanhe.js` into `node:vm` with a stub `ctx`, serves `fixtures/dashboard.html` as the required response and `fixtures/records.json` as the optional one, and asserts the mapped snapshot, the chart, and the degraded paths.
- `fixtures/dashboard.html` — verbatim capture of the dashboard's stat grid and VIP block; it is the parser's contract. Replace it with a fresh capture, never with a description of the page.
- `fixtures/records.json` — a contiguous excerpt of a real `get_usage_records` response (210 records, 2026-10-11 14:00–19:59 local; the vendor answers with compact JSON, so the excerpt is byte-identical apart from the shortened list). It carries the real envelope and the real 15:00–17:59 silence, which is what makes the zero-fill and the partial-hour rule testable. Replace it with a fresh capture the same way.
- `tools/repro/` — optional SwiftPM harness that runs the plugin through CodexBar's real runtime (`UserProviderPluginLoader` → `ProviderPluginRuntime` → QuickJS/JavaScriptCore) with a stub transport. Needs a CodexBar checkout; see its `README.md`. Not part of the check.
- `docs/superpowers/plans/` — implementation plans for larger changes.
- `README.md` — install/check entry point. Keep it short; details belong in this file or the code.

## Data flow

`ctx.browser.sessions("api.0ki.cn")` → `GET https://api.0ki.cn/dashboard.php` with that session's `Cookie` header → HTML → strip `<script>`/`<style>`/tags/entities and collapse whitespace → Chinese-label regexes → snapshot `{primary, secondary, details, identity, dataConfidence}`.

Two windows, and they come from **different places on the page** — this is the part that is easy to get wrong:

- `primary` — the 5-hour period (`PERIOD_WINDOW_MINUTES = 300`). The remaining count is the bare `请求次数余额` stat (`<p class="stat-value">1,796</p>`); the cap is `每期1,800次` in the VIP block. `resetsAt` comes from the VIP block's `…后重置` countdown, which is relative to the refresh, so it is resolved at parse time.
- `secondary` — the calendar month, from the VIP block's `每月30,000次` cap and `本周期剩余 23,941 / 30,000 次`, with `MONTH_WINDOW_MINUTES = 43200`. The page prints no monthly reset time, so it reports `resetDescription` instead of an invented `resetsAt`.

`dashboardAllowances` reads `每期 … 每月 … 本周期剩余 …` as **one anchored block** (`[\s\S]{0,300}?` between them) rather than three independent searches: the store page and upgrade cards list other tiers' numbers, and only the block keeps the right ones together. The period balance is deliberately allowed to exceed its cap — a top-up purchase leaves `请求次数余额` above `每期` — so the used count clamps at 0 instead of failing the fetch. Do not "tighten" that into a rejection.

Because `primary` and `secondary` are both set, CodexBar's menu bar metric picker offers Primary, Secondary and Average for this provider; `Automatic` follows `primary`. Never move the monthly window into `extraWindows`: user-plugin cards render only `primary`/`secondary`/`tertiary`, and the bar titles are hard-coded by the host.

### Recent-usage chart

The chart is a **second, optional** request on the same origin, issued with the required dashboard fetch in one round trip:

```
ctx.http.getWithOptional("https://api.0ki.cn/dashboard.php",
                         "https://api.0ki.cn/user_api.php?action=get_usage_records&page=1&page_size=1500",
                         { headers: { Cookie: session.header }, optionalBudgetSeconds: 5 })
```

`getWithOptional` returns the dashboard as the response itself and the log under `.optional`, which the host sets to `null` when the optional request fails, runs past the budget, or exceeds the 1 MiB response cap. That is why the chart must never throw: `recentUsage` returns `null` for anything it cannot use, and `fetchUsage` wraps it in its own `try`/`catch`. **A chart problem must never cost the user their two windows.**

`optionalBudgetSeconds` is load-bearing, not tuning. Both requests start together, and the host stops waiting for the optional one once the budget has elapsed *since the required request started* — the default is **200 ms**, which the real 560 KB page (~0.6 s) does not reliably beat. Without the option the app silently drops the chart on every refresh while `node check.mjs` (an instant stub) stays green; `tools/repro/repro.sh --records-delay 0.6` reproduces it. The host accepts 0–5 seconds and clamps the optional request's own timeout to 5 s, so `RECORDS_BUDGET_SECONDS = 5` is both the maximum and the value bundled Abacus passes. `check.mjs` asserts the option is present and within range.

The endpoint only accepts `page` and `page_size` (`date`/`start_date`/`days`/`granularity` are ignored — verified against the live API), and `page_size=1500` measured 560 KB, 373 bytes per record, ~0.6 s, and ~28 h of history. Daily buckets are therefore out of reach: a week of records is several MiB, well past the 1 MiB cap. The chart is hourly, which is also the scale that matches the 5-hour `primary` window.

Bucketing rules, all deliberate:

- Records carry `request_time` (`YYYY-MM-DD HH:MM:SS`, the vendor's local clock) and `requests_deducted` (a decimal string, the billed count that consumes the allowance; it equals `request_count` except for the rare unbilled row). The chart sums `requests_deducted`.
- Hours are counted on the **vendor's** clock with `daysFromCivil`/`civilFromDays` integer maths — no `Date`, no `Intl`, and no assumption about the machine's zone (`ctx.env` exposes only `timeZone`, which is the user's zone, not the server's).
- The log is newest-first and complete, so an hour with no records inside the fetched range really is zero: gaps are filled with zero bars rather than compressed away.
- The page cuts mid-hour, so the oldest bucket is partial and is **dropped** (`if (oldest.minute !== 0) start += 1`). Do not remove that rule to gain one more bar: it is what stops the chart from showing a dip that never happened.
- A quiet account can span more hours than the host allows points; the newest `CHART_MAX_HOURS = 120` are kept.
- The chart is one detail section (`最近用量`) with `统计范围` / `区间请求` / `峰值小时` rows. Host-rendered charts draw no axis labels (labels reach VoiceOver only), so the range row is what makes the span explicit.

The dashboard HTML is the source of truth: the public API documents Bearer auth but exposes no balance or usage endpoint. `fixtures/dashboard.html` is a verbatim capture of the stat grid and VIP block — when the vendor rewords the page, replace it with a fresh capture and update the regexes together. Never loosen a regex into silently accepting a missing field, and never rewrite the fixture from memory or from a description of the page: a fixture edited from a paraphrase is what produced the "missing period allowance" regression, where the parser expected `请求次数余额 1,567 / 1,800` but the page holds a bare `1,796`.

## Error ladder

`fetchUsage` owns HTTP classification because the manifest declares `http-status`. Preserve the order and the per-candidate loop:

1. `ctx.browser.availability` `"off"` → `ctx.fail.missingCredential`.
2. Empty/non-string session header → `rejectCookie`, continue to the next candidate.
3. `401`/`403`/`301`/`302` → `rejectCookie`, continue.
4. `429` → `ctx.fail.rateLimited`; `>=500` → `providerUnavailable`; any other non-200 → `apiFailure`. These are terminal, not per-candidate.
5. Parse failure on a login page → `rejectCookie`, continue; any other parse failure → `ctx.fail.parseFailure`.
6. Exhausted candidates: `authenticationExpired` if anything was rejected, otherwise `missingCredential` telling the user which browser to sign in with.

`check.mjs` stubs `ctx.fail.*` as plain `Error`s; keep every `ctx.fail` name it lists valid, and add a stub when a new one appears. Host-side stubs mirror the real host contract: the `acceptCookie` stub throws on purpose, because the host only allows that call for bundled plugins that declare `cookiePolicy.cache: "validatedSingleEntry"`. Do not soften it back to a no-op, and do not call `acceptCookie` from the plugin — user plugins have no persistent cookie cache.

## Runtime constraints

The plugin runs in QuickJS-NG under a 20-second watchdog with a 64 MiB heap. There is no `fetch`, `XMLHttpRequest`, timer, `require`, `process`, or filesystem, and `Intl` is unavailable — use `ctx.format.*` / `ctx.date.*` instead of `toLocaleString` or `Intl`. Network access is limited to the declared origin `https://api.0ki.cn`, with redirects rejected and responses capped at 1 MiB.

Snapshots are validated, not truncated: at most 8 detail sections, 24 rows per section, 120 characters per detail string; `usedPercent` is clamped to 0–100. A wrong type or limit violation fails the whole fetch, so keep values as plain strings and numbers.

## Approval boundary

`~/Library/Application Support/CodexBar/plugin-approvals.json` pins `instanceID`, origins, auth mode, capabilities, and cookie domains. Changing `id`, `endpoints`, `auth`, `capabilities`, or `cookieDomains` forces the user to re-approve the plugin — do not add `persistent-storage` or any other capability for convenience. `settings` is intentionally empty: this plugin stores no key and no cookie, and credentials only ever flow through `ctx.browser`. Never log, persist, or return a cookie value.

## Verify

```sh
node check.mjs
```

Run it after every edit to `shanhe.js` or the fixture, and expect `shanhe plugin syntax and dashboard parser checks passed`. It is the whole test suite: no test framework, no `package.json`, no npm install. Do not add dependencies or tooling unless the change genuinely needs them.

`check.mjs` fakes the host, so it cannot catch a host-side contract the way the app does. When a change depends on runtime behaviour (engine APIs, cookie sessions, snapshot limits) or the app disagrees with the check, reproduce it with the real engine instead:

```sh
CODEXBAR_SOURCE=/path/to/CodexBar tools/repro/repro.sh --expect-ok
```

## Install

Copy `shanhe.js` to `~/.config/codexbar/providers/shanhe.js` and refresh CodexBar (or use **Settings → Plugins → Install…**). This machine's installed copy is expected to match the repo file byte for byte — check with `diff` after editing, and sign in to `https://api.0ki.cn/dashboard.php` in Chrome when the plugin reports an expired session.

**After every functional change to `shanhe.js`, copy it to `~/.config/codexbar/providers/shanhe.js` before finishing** (outside the sandbox workspace, so this may need an elevated file operation), then confirm with `diff`.

## Commits

Short lowercase conventional subjects scoped to the change: `feat:`, `fix:`, `docs:`. Keep commits scoped to one concern and update `README.md` only when install or visible fields change.
