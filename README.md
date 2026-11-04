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

Sign in to `https://api.0ki.cn/dashboard.php` in Chrome, then import the session:

```sh
./tools/shanhe-login
codexbar plugins fetch shanhe-cli --json --pretty
```

The optional helper needs `uv` (Python and its pinned `browser-cookie3` dependency are managed in an isolated environment). It reads the selected browser's cookies, validates them through the real CLI plugin, and only then saves `pluginSecrets.COOKIE` to CodexBar's config with mode `0600`. Failed reads or validation leave the saved Cookie unchanged. The first run requests CodexBar approval in an interactive terminal. Keep the desktop keyring unlocked. Config selection follows `CODEXBAR_CONFIG`, absolute `XDG_CONFIG_HOME`, and CodexBar's legacy fallback.

Use `./tools/shanhe-login --profile 'Profile 1'` for another Chrome profile, or `--browser chromium` for Chromium. To make it available from any directory:

```sh
install -Dm755 tools/shanhe-login ~/.local/bin/shanhe-login
shanhe-login
```

Run it again after signing back in when a session expires. The helper never prints Cookie values. macOS desktop users can continue using `shanhe.js` with automatic browser sessions.

Manual fallback: in DevTools → Network, copy the dashboard request's **Cookie header value** (`name=value; name2=value2`, without the `Cookie:` prefix). In Bash:

```bash
read -rsp 'Shanhe Cookie: ' CODEXBAR_PLUGIN_SHANHE_CLI_COOKIE
printf '\n'
export CODEXBAR_PLUGIN_SHANHE_CLI_COOKIE
codexbar plugins fetch shanhe-cli --json --pretty
```

The host injects the secure `COOKIE` setting into both requests; the plugin never reads or stores it. The manual environment variable lasts for the current shell and overrides any saved Cookie; use `unset CODEXBAR_PLUGIN_SHANHE_CLI_COOKIE` to return to the saved credential. Use `plugins fetch shanhe-cli` for text output. This version has its own ID, so it can coexist with the desktop plugin. CLI text prints detail rows; JSON also carries the chart data.

For [omarchy-codexbar](https://github.com/felixzsh/omarchy-codexbar), CodexBar 0.83's `usage` command omits user plugins. Install the optional Python 3 adapter and point the widget to it:

```sh
install -Dm755 tools/codexbar-with-plugins ~/.local/bin/codexbar-with-plugins
omarchy bar set felixzsh.codexbar codexbarBin "$HOME/.local/bin/codexbar-with-plugins"
omarchy shell local.codexbar refresh
```

It merges enabled, installed user-plugin snapshots into usage JSON while preserving built-ins and forwarding other commands (`cost`, `--version`, etc.) to the real CLI. The widget's provider dropdown then offers **Shanhe Cli**, with Session (5 hours) and Monthly limits. Errors remain per-provider. It uses the saved Cookie and never imports browser sessions during background polling. To undo, set `codexbarBin` back to `codexbar`. Upstream widget files are unchanged.

The provider shows two usage windows as progress bars: the 5-hour period (per-period limit, reset countdown) and the calendar month. Because both windows are declared, CodexBar's **Menu bar metric** offers Primary, Secondary, and Average, and the menu bar / Overview icon follows the selected window. It also lists account balance, billed requests, token totals, concurrency, and plan expiry from the dashboard HTML.

Below those rows the card draws a recent-usage bar chart: requests per hour over the last day or so, taken from the same account's request log (`get_usage_records`). Quiet hours are drawn as zero bars, and the `统计范围` row states exactly which hours the chart covers. The log is optional enrichment — if that request fails, the two windows still render and the chart is simply absent.

## Check

```sh
node check.mjs
```

For the optional login helper, run `python3 tools/check_login.py` (offline, standard library only).
For the optional Omarchy adapter, run `python3 tools/check_omarchy_adapter.py` (also offline).

`check.mjs` stubs CodexBar's host, so it cannot catch host-side contracts. To run the plugin through the real runtime (QuickJS/JavaScriptCore), use the optional harness in `tools/repro/` with a CodexBar checkout:

```sh
CODEXBAR_SOURCE=/path/to/CodexBar tools/repro/repro.sh
```
