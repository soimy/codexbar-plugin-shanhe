# CodexBar Shanhe plugin

Third-party provider plugin for Shanhe (`api.0ki.cn`). It stores the API key in CodexBar's secure settings and requests usage from `/v1/usage` by default.

## Install

Copy `shanhe.js` into CodexBar's user provider plugin directory, then configure:

- `SHANHE_API_KEY` (secure)
- `SHANHE_BASE_URL` (optional, defaults to `https://api.0ki.cn`)
- `SHANHE_USAGE_PATH` (optional, defaults to `/v1/usage`)

The current parser accepts `used`/`limit`, `consumed`/`total`, or `spent`/`quota` under either the response root or a `usage` object. Confirm the exact Shanhe response contract before relying on production data.

## Check

```sh
node check.mjs
```
