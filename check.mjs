import { readFile } from "node:fs/promises";
import vm from "node:vm";
const source = await readFile(new URL("./shanhe.js", import.meta.url), "utf8");
if (!source.includes("defineProvider({") || !source.includes('id: "shanhe"')) throw new Error("provider manifest missing");
const fixture = await readFile(new URL("./fixtures/dashboard.html", import.meta.url), "utf8");
const recordsFixture = await readFile(new URL("./fixtures/records.json", import.meta.url), "utf8");
let provider;
vm.runInNewContext(source, { defineProvider: (value) => { provider = value; } });

// 2026-10-11T19:00:00+08:00, so the fixture's "0小时14分钟后重置" resolves to 19:14 local.
const NOW_MILLIS = Date.UTC(2026, 9, 11, 11, 0, 0);
const calls = [];
const context = (bodyText, records = recordsFixture) => ({
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
  // Mirrors the host: the required dashboard body plus the optional records payload, which is null
  // whenever that second request failed, was too slow, or exceeded the 1 MiB response cap.
  http: {
    getWithOptional: async (url, optionalUrl, options) => {
      calls.push({ url, optionalUrl, options });
      return {
        status: 200,
        bodyText,
        optional: records === null ? null : { status: 200, bodyText: records },
      };
    },
  },
  fail: Object.fromEntries(["missingCredential", "authenticationExpired", "permissionDenied", "rateLimited", "providerUnavailable", "apiFailure", "parseFailure"].map((key) => [key, (message) => new Error(message)])),
  pct: (used, limit) => used / limit * 100,
  date: { nowMillis: () => NOW_MILLIS, unixMillis: (value) => new Date(value) },
  format: { number: (value) => value.toLocaleString("en-US") },
});

const result = await provider.fetchUsage(context(fixture));
const close = (actual, expected) => Math.abs(actual - expected) < 1e-9;
const row = (section, label) => result.details[section].rows.find((item) => item.label === label);
if (!close(result.primary.usedPercent, (1800 - 1796) / 1800 * 100)) throw new Error(`primary usedPercent ${result.primary.usedPercent}`);
if (result.primary.windowMinutes !== 300) throw new Error(`primary windowMinutes ${result.primary.windowMinutes}`);
if (result.primary.resetsAt?.getTime() !== NOW_MILLIS + (3 * 60 + 48) * 60 * 1000) throw new Error("primary resetsAt");
if (!close(result.secondary.usedPercent, (30000 - 23941) / 30000 * 100)) throw new Error(`secondary usedPercent ${result.secondary.usedPercent}`);
if (result.secondary.windowMinutes !== 43200) throw new Error(`secondary windowMinutes ${result.secondary.windowMinutes}`);
if (result.details[0].title !== "用量窗口" || result.details[1].title !== "账户") throw new Error("detail sections");
if (row(0, "5小时周期")?.value !== "4 / 1,800") throw new Error("period row");
if (row(0, "本月")?.value !== "6,059 / 30,000") throw new Error("monthly row");
if (row(0, "周期重置")?.value !== "3h 48m 后") throw new Error("reset row");
if (row(1, "账户余额")?.value !== "¥0.00") throw new Error("balance row");
if (row(1, "套餐")?.value !== "GLM系列年卡 ——星光编程套餐") throw new Error("plan row");
if (row(1, "并发数")?.value !== "0 / 3") throw new Error("concurrency row");

// The chart comes from the optional `get_usage_records` page. The fixture is a real 210-record
// excerpt: it starts at 14:28 (an hour the page boundary cut in half, so that bar is dropped) and
// holds the vendor's real 15:00–17:59 silence, which must appear as three zero bars.
const chartSection = result.details[2];
if (chartSection?.title !== "最近用量") throw new Error("recent usage section");
const chart = chartSection.chart;
if (chart?.kind !== "bars" || chart?.title !== "每小时请求数" || chart?.unit !== "次") throw new Error("chart header");
const labels = chart.points.map((point) => point.label).join(", ");
if (labels !== "10-11 15:00, 10-11 16:00, 10-11 17:00, 10-11 18:00, 10-11 19:00") throw new Error(`chart labels: ${labels}`);
const values = chart.points.map((point) => point.value).join(", ");
if (values !== "0, 0, 0, 235, 145") throw new Error(`chart values: ${values}`);
if (row(2, "统计范围")?.value !== "10-11 15:00 → 10-11 19:00") throw new Error("chart range row");
if (row(2, "区间请求")?.value !== "380 次") throw new Error("chart total row");
if (row(2, "峰值小时")?.value !== "10-11 18:00 · 235 次") throw new Error("chart peak row");

// The host stops collecting the optional response 200 ms after the required request starts unless
// the plugin raises the budget, and the real 560 KB records page takes about 0.6 s. Without
// `optionalBudgetSeconds` the chart would be missing in the app while this check stayed green
// (verified against the real runtime: tools/repro with --records-delay 0.6).
const call = calls.at(-1);
if (call.url !== "https://api.0ki.cn/dashboard.php") throw new Error(`required url ${call.url}`);
if (call.optionalUrl !== "https://api.0ki.cn/user_api.php?action=get_usage_records&page=1&page_size=1500") {
  throw new Error(`optional url ${call.optionalUrl}`);
}
if (call.options?.headers?.Cookie !== "session=fixture") throw new Error("records request lost the session cookie");
if (!(call.options?.optionalBudgetSeconds >= 0.6)) throw new Error(`optionalBudgetSeconds ${call.options?.optionalBudgetSeconds}`);
if (call.options?.optionalBudgetSeconds > 5) throw new Error("optionalBudgetSeconds exceeds the host's 0-5 range");

// The records request is enrichment: without it the two windows still have to render.
const withoutRecords = await provider.fetchUsage(context(fixture, null));
if (withoutRecords.details.length !== 2) throw new Error("optional records request changed the window sections");
if (!close(withoutRecords.primary.usedPercent, result.primary.usedPercent)) throw new Error("primary changed without records");
for (const body of ["<html>not json</html>", "{}", '{"success":false,"message":"未登录"}']) {
  const broken = await provider.fetchUsage(context(fixture, body));
  if (broken.details.length !== 2) throw new Error(`records body ${body} produced a chart`);
}

// A quiet account can span more hours than the host allows chart points; the newest 120 are kept.
const stamp = (offset) => {
  const date = new Date(Date.UTC(2026, 8, 1, 0, 0, 0) + offset * 3600 * 1000);
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:00:00`;
};
const sparse = {
  success: true,
  data: {
    list: Array.from({ length: 200 }, (_, index) => ({ request_time: stamp(index), requests_deducted: "3.00" })).reverse(),
    total: 200,
    page: 1,
    page_size: 1500,
  },
};
const truncated = await provider.fetchUsage(context(fixture, JSON.stringify(sparse)));
if (truncated.details[2].chart.points.length !== 120) throw new Error("chart point cap");
if (truncated.details[2].chart.points[0].label !== "09-04 08:00") throw new Error("chart cap kept the wrong end");

// Both sides of the partial-hour rule: a record exactly on the hour keeps its bucket, while a log
// that lives inside a single cut hour leaves nothing to draw.
const recordsBody = (list) => JSON.stringify({ success: true, data: { list, total: list.length, page: 1, page_size: 1500 } });
const chartOf = (snapshot) => snapshot.details.find((section) => section.title === "最近用量")?.chart;
const onTheHour = await provider.fetchUsage(context(fixture, recordsBody([
  { request_time: "2026-10-11 22:30:00", requests_deducted: "4.00" },
  { request_time: "2026-10-11 21:00:00", requests_deducted: "9.00" },
])));
if (onTheHour.details[2].chart.points.map((point) => point.value).join(", ") !== "9, 4") {
  throw new Error("an oldest record on the hour must keep its bucket");
}
const oneHour = await provider.fetchUsage(context(fixture, recordsBody([
  { request_time: "2026-10-11 22:30:00", requests_deducted: "4.00" },
])));
if (chartOf(oneHour) !== undefined) throw new Error("a single cut hour produced a chart");

// A missing allowance block must fail the fetch instead of degrading into a silent zero.
await provider.fetchUsage(context(fixture.replace("每期1,800次", ""))).then(
  () => { throw new Error("missing per-period allowance was accepted"); },
  (error) => {
    if (!/missing per-period allowance/.test(error.message)) throw new Error(`unexpected error: ${error.message}`);
  },
);
console.log("shanhe plugin syntax and dashboard parser checks passed");
