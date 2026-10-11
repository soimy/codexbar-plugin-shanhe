# Real-engine plugin repro

Runs `shanhe.js` through CodexBar's actual plugin runtime — `UserProviderPluginLoader` →
`ProviderPluginRuntime` → QuickJS or JavaScriptCore — instead of the hand-written `ctx` stub in
`check.mjs`. Use it when a plugin behaves differently in the app than in `node check.mjs`.

A stub can hide host-side contracts. `check.mjs` used to stub `acceptCookie` as a no-op, so the
plugin stayed green locally while every successful fetch failed inside the app with
`Provider plugin secret access denied: cookie persistence is unavailable`. This harness would have
shown that immediately.

`node check.mjs` remains the required check; this is a debugging tool.

## Requirements

- macOS 14+, Swift 6.2 toolchain (Xcode)
- A CodexBar checkout, because the harness links `CodexBarCore`

```sh
git clone --depth 1 https://github.com/steipete/CodexBar /tmp/CodexBar
export CODEXBAR_SOURCE=/tmp/CodexBar
```

`CODEXBAR_SOURCE` may be absolute or relative to `tools/repro/`; without it the default is a
sibling `../../CodexBar` checkout. Run the tool from the repository root so `shanhe.js` and
`fixtures/dashboard.html` resolve.

## Usage

```sh
tools/repro/repro.sh                                  # shanhe.js against fixtures/dashboard.html
tools/repro/repro.sh shanhe.js session                # same, spelled out
tools/repro/repro.sh shanhe.js missing                # Chrome has no session for the domain
tools/repro/repro.sh shanhe.js session /tmp/login.html  # serve your own response body
tools/repro/repro.sh --status 401                     # exercise the HTTP error ladder
tools/repro/repro.sh --expect-ok                      # exit 1 when a fetch fails
CODEXBAR_PLUGIN_ENGINE=jsc tools/repro/repro.sh       # force the JavaScriptCore rollback engine
```

`mode` selects what the browser-cookie resolver does: `session` (a cookie header), `missing` (throws
exactly like `UserProviderPluginCookieBroker` when Chrome has no cookies for the domain), or `empty`
(an empty header). Fetches run `--attempts` times (default 3) on one runtime, matching how the app
reuses a runtime across refreshes.

Host-side activity is traced on stderr, so you can see the cookie resolver and every HTTP request:

```
engine: default (QuickJS)
mode:   session — resolver returns a session cookie header
loaded: shanhe — Shanhe
  [host] cookieSession api.0ki.cn
  [host] HTTP GET https://api.0ki.cn/dashboard.php cookie=session=fixture
fetch #1: OK
  primary.usedPercent: 14.71
```

## What it does not cover

- The stub transport serves one canned body for every request: no real network, no redirects.
- Chrome's cookie store is not read; the resolver is simulated (see `mode` above).
- Approvals are written to a throwaway store under `$TMPDIR/codexbar-plugin-repro`, never to
  `~/Library/Application Support/CodexBar/plugin-approvals.json`.
- It links the checkout's `HEAD`, which may be newer than the CodexBar app you are running. To
  reproduce an app build exactly, check out that build's tag first
  (`git -C "$CODEXBAR_SOURCE" checkout v0.73.0`).

If SwiftPM cannot write its caches (restricted environments), point `HOME`, `CLANG_MODULE_CACHE_PATH`
and `TMPDIR` at a writable directory before running the script.
