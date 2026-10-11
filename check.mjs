import { readFile } from "node:fs/promises";
import vm from "node:vm";
const source = await readFile(new URL("./shanhe.js", import.meta.url), "utf8");
if (!source.includes("defineProvider({") || !source.includes('id: "shanhe"')) throw new Error("provider manifest missing");
const fixture = await readFile(new URL("./fixtures/dashboard.html", import.meta.url), "utf8");
let provider;
vm.runInNewContext(source, { defineProvider: (value) => { provider = value; } });

// 2026-10-11T19:00:00+08:00, so the fixture's "0小时14分钟后重置" resolves to 19:14 local.
const NOW_MILLIS = Date.UTC(2026, 9, 11, 11, 0, 0);
const context = (bodyText) => ({
  browser: {
    availability: () => "manual",
    sessions: async function* () { yield { id: "fixture", header: "session=fixture" }; },
    // User plugins cannot call acceptCookie: the host requires a bundled cookiePolicy with cache
    // "validatedSingleEntry". Throwing here keeps that contract honest, so re-adding the call fails
    // this check instead of only failing inside the app.
    acceptCookie: () => { throw new Error("cookie persistence is unavailable"); },
    rejectCookie: () => {},
    supportedBrowsers: "Chrome",
  },
  http: { get: async () => ({ status: 200, bodyText }) },
  fail: Object.fromEntries(["missingCredential", "authenticationExpired", "permissionDenied", "rateLimited", "providerUnavailable", "apiFailure", "parseFailure"].map((key) => [key, (message) => new Error(message)])),
  pct: (used, limit) => used / limit * 100,
  date: { nowMillis: () => NOW_MILLIS, unixMillis: (value) => new Date(value) },
  format: { number: (value) => value.toLocaleString("en-US") },
});

const result = await provider.fetchUsage(context(fixture));
const close = (actual, expected) => Math.abs(actual - expected) < 1e-9;
const row = (section, label) => result.details[section].rows.find((item) => item.label === label);
if (!close(result.primary.usedPercent, (1800 - 1567) / 1800 * 100)) throw new Error(`primary usedPercent ${result.primary.usedPercent}`);
if (result.primary.windowMinutes !== 300) throw new Error(`primary windowMinutes ${result.primary.windowMinutes}`);
if (result.primary.resetsAt?.getTime() !== NOW_MILLIS + 14 * 60 * 1000) throw new Error("primary resetsAt");
if (!close(result.secondary.usedPercent, (30000 - 25587) / 30000 * 100)) throw new Error(`secondary usedPercent ${result.secondary.usedPercent}`);
if (result.secondary.windowMinutes !== 43200) throw new Error(`secondary windowMinutes ${result.secondary.windowMinutes}`);
if (result.details[0].title !== "Usage windows" || result.details[1].title !== "Account") throw new Error("detail sections");
if (row(0, "5-hour period")?.value !== "233 / 1,800 used") throw new Error("period row");
if (row(0, "This month")?.value !== "4,413 / 30,000 used") throw new Error("monthly row");
if (row(0, "Period resets")?.value !== "14m left") throw new Error("reset row");
if (row(1, "Account balance")?.value !== "¥0.00") throw new Error("balance row");

// A missing allowance pair must fail the fetch instead of degrading into a silent zero.
await provider.fetchUsage(context(fixture.replace("1,567 / 1,800", "3"))).then(
  () => { throw new Error("missing period allowance was accepted"); },
  (error) => {
    if (!/missing period allowance/.test(error.message)) throw new Error(`unexpected error: ${error.message}`);
  },
);
console.log("shanhe plugin syntax and dashboard parser checks passed");
