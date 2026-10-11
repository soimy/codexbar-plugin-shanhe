# CodexBar Shanhe plugin

Third-party provider plugin for Shanhe (`api.0ki.cn`). It reuses CodexBar's browser-cookie session and reads the server-rendered dashboard.

The dashboard is the source of truth because the public API documentation does not expose a balance endpoint. No API key or cookie is stored by this plugin.

## Install

Copy `shanhe.js` into CodexBar's user provider plugin directory. Sign in to `https://api.0ki.cn/dashboard.php` in a supported browser, then refresh CodexBar.

The provider shows two usage windows as progress bars: the 5-hour period (per-period limit, reset countdown) and the calendar month. Because both windows are declared, CodexBar's **Menu bar metric** offers Primary, Secondary, and Average, and the menu bar / Overview icon follows the selected window. It also lists account balance, billed requests, token totals, concurrency, and plan expiry from the dashboard HTML.

## Check

```sh
node check.mjs
```

`check.mjs` stubs CodexBar's host, so it cannot catch host-side contracts. To run the plugin through the real runtime (QuickJS/JavaScriptCore), use the optional harness in `tools/repro/` with a CodexBar checkout:

```sh
CODEXBAR_SOURCE=/path/to/CodexBar tools/repro/repro.sh
```
