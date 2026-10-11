# Repository Guidelines

Third-party CodexBar user plugin for Shanhe (`api.0ki.cn`). The plugin is one JavaScript file with no build step, no dependencies, no CI; the only extra tooling is the optional real-engine harness in `tools/repro/`.

## Layout

- `shanhe.js` — the entire plugin: `normalizeDashboard` / `dashboardNumber` / `parseDashboard` helpers plus exactly one `defineProvider({...})` call. No imports, no modules, no shared state outside the fetch.
- `check.mjs` — the only check. Loads `shanhe.js` into `node:vm` with a stub `ctx`, serves `fixtures/dashboard.html` as the dashboard response, and asserts the mapped snapshot.
- `fixtures/dashboard.html` — hand-trimmed capture of the real server-rendered dashboard; it is the parser's contract.
- `tools/repro/` — optional SwiftPM harness that runs the plugin through CodexBar's real runtime (`UserProviderPluginLoader` → `ProviderPluginRuntime` → QuickJS/JavaScriptCore) with a stub transport. Needs a CodexBar checkout; see its `README.md`. Not part of the check.
- `docs/superpowers/plans/` — implementation plans for larger changes.
- `README.md` — install/check entry point. Keep it short; details belong in this file or the code.

## Data flow

`ctx.browser.sessions("api.0ki.cn")` → `GET https://api.0ki.cn/dashboard.php` with that session's `Cookie` header → HTML → strip `<script>`/`<style>`/tags/entities and collapse whitespace → Chinese-label regexes → snapshot `{primary.usedPercent, details, identity, dataConfidence}`.

The dashboard HTML is the source of truth: the public API documents Bearer auth but exposes no balance or usage endpoint. If the vendor rewords the page, update the regexes and `fixtures/dashboard.html` together — never loosen a regex into silently accepting a missing field. `dashboardNumber` throws on a missing or invalid label by design; keep it that way.

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

## Commits

Short lowercase conventional subjects scoped to the change: `feat:`, `fix:`, `docs:`. Keep commits scoped to one concern and update `README.md` only when install or visible fields change.
