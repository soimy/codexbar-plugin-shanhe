# CodexBar Shanhe plugin

Third-party provider plugin for Shanhe (`api.0ki.cn`). It reuses CodexBar's browser-cookie session and reads the server-rendered dashboard.

The dashboard is the source of truth because the public API documentation does not expose a balance endpoint. No API key or cookie is stored by this plugin.

## Install

Copy `shanhe.js` into CodexBar's user provider plugin directory. Sign in to `https://api.0ki.cn/dashboard.php` in a supported browser, then refresh CodexBar.

The provider reads account balance, request balance, billed requests, token totals, concurrency, plan allowance, cycle remaining, reset countdown, and expiry from the dashboard HTML.

## Check

```sh
node check.mjs
```
