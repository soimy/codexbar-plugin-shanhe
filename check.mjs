import { readFile } from "node:fs/promises";
import vm from "node:vm";
const source = await readFile(new URL("./shanhe.js", import.meta.url), "utf8");
if (!source.includes("defineProvider({") || !source.includes('id: "shanhe"')) throw new Error("provider manifest missing");
const fixture = await readFile(new URL("./fixtures/dashboard.html", import.meta.url), "utf8");
let provider;
vm.runInNewContext(source, { defineProvider: (value) => { provider = value; } });
const result = await provider.fetchUsage({
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
  http: { get: async () => ({ status: 200, bodyText: fixture }) },
  fail: Object.fromEntries(["missingCredential", "authenticationExpired", "permissionDenied", "rateLimited", "providerUnavailable", "apiFailure", "parseFailure"].map((key) => [key, (message) => new Error(message)])),
  pct: (used, limit) => used / limit * 100,
});
if (Math.abs(result.primary.usedPercent - 14.71) > 0.001 || !result.details[0].rows.some((row) => row.label === "Account balance" && row.value === "¥0.00")) {
  throw new Error("dashboard parser mismatch");
}
console.log("shanhe plugin syntax and dashboard parser checks passed");
