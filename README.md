# CodexBar Shanhe plugin

Third-party provider plugins for Shanhe (`api.0ki.cn`), reading the server-rendered dashboard.

The dashboard is the source of truth because the public API documentation does not expose a balance endpoint.

## Install

Copy `shanhe.js` into CodexBar's user provider plugin directory. Sign in to `https://api.0ki.cn/dashboard.php` in a supported browser, then refresh CodexBar.

`shanhe.js` is the macOS desktop version; it uses the host's browser sessions and stores no credentials.

For CodexBar CLI 0.83.0, install the standalone manual-Cookie companion from this repository's root:

```sh
mkdir -p ~/.config/codexbar/providers
cp shanhe-cli.js ~/.config/codexbar/providers/shanhe-cli.js
codexbar plugins list
```

Use a copy: the 0.83.0 loader rejects symbolic links as non-regular files. Copy it again after updating the repository version.

Sign in to `https://api.0ki.cn/dashboard.php`. In browser DevTools → Network, copy the dashboard request's **Cookie header value** (`name=value; name2=value2`, without the `Cookie:` prefix). In Bash, enter it without echoing it or putting it in shell history:

```bash
read -rsp 'Shanhe Cookie: ' CODEXBAR_PLUGIN_SHANHE_CLI_COOKIE
printf '\n'
export CODEXBAR_PLUGIN_SHANHE_CLI_COOKIE
codexbar plugins fetch shanhe-cli --json --pretty
```

The first fetch asks for approval in an interactive terminal. The host injects the secure `COOKIE` setting into both requests; the script never reads or stores it. The environment variable lasts for the current shell; repeat the prompt after opening a new shell or when the session expires. Use `unset CODEXBAR_PLUGIN_SHANHE_CLI_COOKIE` to remove it. Use `plugins fetch shanhe-cli` for text output. This version has its own ID, so it can coexist with the desktop plugin. CLI text prints detail rows; JSON also carries the chart data.

The provider shows two usage windows as progress bars: the 5-hour period (per-period limit, reset countdown) and the calendar month. Because both windows are declared, CodexBar's **Menu bar metric** offers Primary, Secondary, and Average, and the menu bar / Overview icon follows the selected window. It also lists account balance, billed requests, token totals, concurrency, and plan expiry from the dashboard HTML.

Below those rows the card draws a recent-usage bar chart: requests per hour over the last day or so, taken from the same account's request log (`get_usage_records`). Quiet hours are drawn as zero bars, and the `统计范围` row states exactly which hours the chart covers. The log is optional enrichment — if that request fails, the two windows still render and the chart is simply absent.

## Check

```sh
node check.mjs
```

`check.mjs` stubs CodexBar's host, so it cannot catch host-side contracts. To run the plugin through the real runtime (QuickJS/JavaScriptCore), use the optional harness in `tools/repro/` with a CodexBar checkout:

```sh
CODEXBAR_SOURCE=/path/to/CodexBar tools/repro/repro.sh
```
