// Shanhe sells 5-hour periods ("每 5 小时 N 次") on top of a monthly cap; the dashboard prints the
// per-period and monthly limits, so only the period length is pinned here.
const PERIOD_WINDOW_MINUTES = 300;
// 30 days, the monthly-window convention the bundled providers use.
const MONTH_WINDOW_MINUTES = 43200;
// The recent-usage chart reads the request log. One page of 1,500 records measured 560 KB (373 bytes
// each) and about 28 hours of history on this account: under the host's 1 MiB response cap.
//
// `optionalBudgetSeconds` is load-bearing, not tuning. Both requests start together and the host
// stops collecting the optional one once the budget has elapsed since the required request began —
// 200 ms by default, which this page (~0.6 s) does not beat. Without the option the chart is dropped
// on every real refresh, silently, while an instant stub stays green. The host accepts 0–5 seconds.
const RECORDS_PAGE_SIZE = 1500;
const RECORDS_BUDGET_SECONDS = 5;
const RECORDS_URL = `https://api.0ki.cn/user_api.php?action=get_usage_records&page=1&page_size=${RECORDS_PAGE_SIZE}`;
// One bar per hour; the host rejects a chart with more than 120 points.
const CHART_MAX_HOURS = 120;

function normalizeDashboard(html) {
  return String(html)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function dashboardNumber(text, pattern, label) {
  const match = pattern.exec(text);
  if (!match) throw new Error(`missing ${label}`);
  const value = Number(match[1].replace(/,/g, ""));
  if (!Number.isFinite(value) || value < 0) throw new Error(`invalid ${label}`);
  return value;
}

// The VIP block prints the limits and the monthly remaining together, in that order:
// "每期1,800次 … 每月30,000次 … 本周期剩余 23,941 / 30,000 次". They are read as one anchored block
// because the page lists other tiers elsewhere, and the block is what keeps them from mixing.
function dashboardAllowances(text) {
  const block = /每期\s*([\d,]+)\s*次[\s\S]{0,300}?每月\s*([\d,]+)\s*次[\s\S]{0,300}?本周期剩余\s*([\d,]+)\s*\/\s*([\d,]+)\s*次/.exec(
    text,
  );
  if (!block) {
    if (!/每期\s*[\d,]+\s*次/.test(text)) throw new Error("missing per-period allowance");
    if (!/本周期剩余\s*[\d,]+\s*\/\s*[\d,]+\s*次/.test(text)) throw new Error("missing monthly allowance");
    throw new Error("allowance block is not contiguous");
  }
  const perPeriod = Number(block[1].replace(/,/g, ""));
  const monthly = Number(block[2].replace(/,/g, ""));
  const monthRemaining = Number(block[3].replace(/,/g, ""));
  const monthLimit = Number(block[4].replace(/,/g, ""));
  if (!Number.isFinite(perPeriod) || perPeriod <= 0) throw new Error("invalid per-period allowance");
  if (!Number.isFinite(monthly) || monthly <= 0 || monthly !== monthLimit) throw new Error("invalid monthly allowance");
  if (!Number.isFinite(monthRemaining) || monthRemaining < 0 || monthRemaining > monthLimit) {
    throw new Error("invalid monthly remaining");
  }
  return { perPeriod, monthLimit, monthRemaining };
}

// "3小时48分钟后重置" / "1天2小时后重置" -> { totalMinutes, label: "3h 48m" | "1d 2h" }.
function dashboardCountdown(text) {
  const match = /((?:\d+\s*天)?\s*(?:\d+\s*小时)?\s*(?:\d+\s*分钟)?)\s*后重置/.exec(text);
  if (!match) return null;
  const days = /(\d+)\s*天/.exec(match[1]);
  const hours = /(\d+)\s*小时/.exec(match[1]);
  const minutes = /(\d+)\s*分钟/.exec(match[1]);
  if (!days && !hours && !minutes) return null;
  const dayCount = days ? Number(days[1]) : 0;
  const hourCount = hours ? Number(hours[1]) : 0;
  const minuteCount = minutes ? Number(minutes[1]) : 0;
  const parts = [];
  if (dayCount) parts.push(`${dayCount}d`);
  if (hourCount) parts.push(`${hourCount}h`);
  if (minuteCount) parts.push(`${minuteCount}m`);
  return {
    totalMinutes: dayCount * 24 * 60 + hourCount * 60 + minuteCount,
    label: parts.length ? parts.join(" ") : "0m",
  };
}

// Civil date <-> day-number conversions (Howard Hinnant's algorithm). The log stamps are already in
// the vendor's local time, so the chart counts hours on the vendor's own clock: the engine has no
// Intl, and ctx.env exposes the machine's zone rather than the server's, so local-time maths is the
// only correct option here.
function daysFromCivil(year, month, day) {
  const shifted = month <= 2 ? year - 1 : year;
  const era = Math.floor(shifted / 400);
  const yearOfEra = shifted - era * 400;
  const dayOfYear = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const dayOfEra = yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146097 + dayOfEra - 719468;
}

function civilFromDays(days) {
  const shifted = days + 719468;
  const era = Math.floor(shifted / 146097);
  const dayOfEra = shifted - era * 146097;
  const yearOfEra = Math.floor(
    (dayOfEra - Math.floor(dayOfEra / 1460) + Math.floor(dayOfEra / 36524) - Math.floor(dayOfEra / 146096)) / 365,
  );
  const year = yearOfEra + era * 400;
  const dayOfYear = dayOfEra - (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100));
  const monthIndex = Math.floor((5 * dayOfYear + 2) / 153);
  const day = dayOfYear - Math.floor((153 * monthIndex + 2) / 5) + 1;
  const month = monthIndex < 10 ? monthIndex + 3 : monthIndex - 9;
  return { year: month <= 2 ? year + 1 : year, month, day };
}

function pad2(value) {
  return (value < 10 ? "0" : "") + value;
}

// "2026-10-11 22:54:56" -> { hour: hours since epoch on the vendor's clock, minute: 54 }.
function logHour(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(String(value));
  if (!match) return null;
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { hour: daysFromCivil(Number(match[1]), month, day) * 24 + Number(match[4]), minute: Number(match[5]) };
}

function hourLabel(hour) {
  const day = Math.floor(hour / 24);
  const civil = civilFromDays(day);
  return `${pad2(civil.month)}-${pad2(civil.day)} ${pad2(hour - day * 24)}:00`;
}

// The request log is newest-first and complete, so an hour without records inside the fetched range
// really had no requests: gaps become zero bars instead of being squeezed out of the chart.
//
// This is optional enrichment, so nothing here throws: a missing, non-JSON, or reshaped payload just
// means no chart, and the two windows still render. A single unusable record is skipped, but the
// envelope itself (`data.list`) has to be an array.
function recentUsage(optional, host) {
  if (!optional || typeof optional.bodyText !== "string") return null;
  let payload = null;
  try {
    payload = JSON.parse(optional.bodyText);
  } catch {
    return null;
  }
  const list = payload && payload.data ? payload.data.list : null;
  if (!Array.isArray(list) || !list.length) return null;

  const totals = new Map();
  let newest = null;
  let oldest = null;
  for (const record of list) {
    if (!record || typeof record !== "object") continue;
    const stamp = logHour(record.request_time);
    const raw = record.requests_deducted;
    if (!stamp || (typeof raw !== "string" && typeof raw !== "number")) continue;
    const requests = Number(raw);
    if (!Number.isFinite(requests) || requests < 0) continue;
    totals.set(stamp.hour, (totals.get(stamp.hour) || 0) + requests);
    if (newest === null || stamp.hour > newest) newest = stamp.hour;
    // The list is newest-first, so the last usable record is the oldest one.
    oldest = stamp;
  }
  if (newest === null || oldest === null) return null;

  // The page cuts mid-hour, so the oldest bucket holds only part of its hour; drop it rather than
  // draw a dip that never happened.
  let start = oldest.hour;
  if (oldest.minute !== 0) start += 1;
  if (start > newest) return null;
  // A quiet account can span more hours than a chart may hold; keep the newest ones.
  if (newest - start + 1 > CHART_MAX_HOURS) start = newest - CHART_MAX_HOURS + 1;

  const points = [];
  for (let hour = start; hour <= newest; hour += 1) {
    points.push({ label: hourLabel(hour), value: totals.get(hour) || 0 });
  }
  let sum = 0;
  let peak = points[0];
  for (const point of points) {
    sum += point.value;
    if (point.value > peak.value) peak = point;
  }

  return {
    title: "最近用量",
    rows: [
      { label: "统计范围", value: `${points[0].label} → ${points[points.length - 1].label}` },
      { label: "区间请求", value: `${host.format.number(sum)} 次` },
      { label: "峰值小时", value: `${peak.label} · ${host.format.number(peak.value)} 次` },
    ],
    chart: { kind: "bars", title: "每小时请求数", unit: "次", points },
  };
}

function parseDashboard(html, host) {
  const text = normalizeDashboard(html);
  if (!/账户余额/.test(text)) throw new Error("dashboard content is missing");
  const format = (value) => host.format.number(value);
  const allowances = dashboardAllowances(text);
  const balance = dashboardNumber(text, /账户余额\s*¥?\s*([\d,]+(?:\.\d+)?)/, "balance");
  // The period balance is a bare number; its cap comes from the VIP block. A purchase on top of the
  // plan can leave the balance above the cap, so the used count is clamped instead of rejected.
  const periodRemaining = dashboardNumber(text, /请求次数余额\s*([\d,]+)/, "period balance");
  const totalBilled = dashboardNumber(text, /累计计费次数\s*([\d,]+)/, "total billed requests");
  const monthlyBilled = dashboardNumber(text, /本月计费次数\s*([\d,]+)/, "monthly billed requests");
  const totalTokens = dashboardNumber(text, /Token\s*已用总数\s*([\d,]+)/i, "total tokens");
  const monthlyTokens = dashboardNumber(text, /Token\s*已用总数\s*[\d,]+\s*本月[:：]\s*([\d,]+)/i, "monthly tokens");
  const countdown = dashboardCountdown(text);
  const concurrency = text.match(/并发数\s*([\d,]+)\s*\/\s*([\d,]+)/);
  const expiry = text.match(/有效期至[:：]\s*([\d.-]+)/);
  const plan = text.match(/VIP会员\s*([\s\S]{1,60}?)\s*\d+\s*(?:天|小时|分钟)/);
  const periodUsed = Math.max(0, allowances.perPeriod - periodRemaining);
  const monthUsed = allowances.monthLimit - allowances.monthRemaining;

  // `primary` is the 5-hour period: it drives the menu bar / Overview percent by default.
  const primary = {
    usedPercent: host.pct(periodUsed, allowances.perPeriod),
    windowMinutes: PERIOD_WINDOW_MINUTES,
    resetDescription: `${format(periodRemaining)} / ${format(allowances.perPeriod)} 剩余`,
  };
  if (countdown) {
    primary.resetsAt = host.date.unixMillis(host.date.nowMillis() + countdown.totalMinutes * 60000);
    primary.resetDescription += ` · ${countdown.label} 后重置`;
  }

  // Display labels are written in Chinese directly. The host's Localizable.strings lookup does not
  // apply to user-plugin detail labels (verified against the app: "Window"/"Balance" stay English),
  // so reusing catalog keys buys nothing; the dashboard is a Chinese product anyway.
  const windowRows = [
    { label: "5小时周期", value: `${format(periodUsed)} / ${format(allowances.perPeriod)}` },
    { label: "本月", value: `${format(monthUsed)} / ${format(allowances.monthLimit)}` },
  ];
  if (countdown) windowRows.push({ label: "周期重置", value: `${countdown.label} 后` });
  // The dashboard prints no monthly reset time; the plan follows the calendar month.
  windowRows.push({ label: "月度重置", value: "自然月" });

  const accountRows = [
    { label: "账户余额", value: `¥${balance.toFixed(2)}` },
    { label: "累计计费", value: format(totalBilled) },
    { label: "本月计费", value: format(monthlyBilled) },
    { label: "累计 Token", value: format(totalTokens) },
    { label: "本月 Token", value: format(monthlyTokens) },
  ];
  if (plan) accountRows.push({ label: "套餐", value: plan[1].trim() });
  if (concurrency) accountRows.push({ label: "并发数", value: `${concurrency[1]} / ${concurrency[2]}` });
  if (expiry) accountRows.push({ label: "有效期至", value: expiry[1] });

  return {
    primary,
    // `secondary` is the monthly allowance; it is user-selectable as the menu bar metric.
    secondary: {
      usedPercent: host.pct(monthUsed, allowances.monthLimit),
      windowMinutes: MONTH_WINDOW_MINUTES,
      resetDescription: "随自然月重置",
    },
    details: [
      { title: "用量窗口", rows: windowRows },
      { title: "账户", rows: accountRows },
    ],
    identity: { loginMethod: "浏览器会话" },
    dataConfidence: "exact",
  };
}

defineProvider({
  id: "shanhe",
  name: "Shanhe",
  icon: { monogram: "SH", tint: "#3684DC" },
  endpoints: ["https://api.0ki.cn"],
  settings: [],
  capabilities: ["browser-cookies", "http-status"],
  cookieDomains: ["api.0ki.cn"],

  async fetchUsage(ctx) {
    const domain = "api.0ki.cn";
    const availability = ctx.browser.availability(domain);
    if (availability === "off") throw ctx.fail.missingCredential("Shanhe browser cookies are disabled.");
    let rejected = false;
    for await (const session of ctx.browser.sessions(domain)) {
      if (typeof session.header !== "string" || !session.header.trim()) {
        ctx.browser.rejectCookie(domain, session);
        rejected = true;
        continue;
      }
      // The dashboard is required; the request log is optional enrichment, so a failed, slow, or
      // oversized records response drops the chart instead of the whole fetch. The budget has to be
      // raised explicitly: the host otherwise stops collecting the optional response 200 ms after the
      // required request started, which a 560 KB page does not reliably beat. Only the optional
      // request's budget changes — the dashboard keeps the host's default timeout.
      const response = await ctx.http.getWithOptional(
        "https://api.0ki.cn/dashboard.php",
        RECORDS_URL,
        { headers: { Cookie: session.header }, optionalBudgetSeconds: RECORDS_BUDGET_SECONDS },
      );
      if (response.status === 401 || response.status === 403 || response.status === 301 || response.status === 302) {
        ctx.browser.rejectCookie(domain, session);
        rejected = true;
        continue;
      }
      if (response.status === 429) throw ctx.fail.rateLimited("Shanhe dashboard requests are rate limited.");
      if (response.status >= 500) throw ctx.fail.providerUnavailable(`Shanhe dashboard returned HTTP ${response.status}.`);
      if (response.status !== 200) throw ctx.fail.apiFailure(`Shanhe dashboard returned HTTP ${response.status}.`);
      let snapshot;
      try {
        snapshot = parseDashboard(response.bodyText, ctx);
      } catch (error) {
        if (/登录|login/i.test(response.bodyText) && !/账户余额/.test(response.bodyText)) {
          ctx.browser.rejectCookie(domain, session);
          rejected = true;
          continue;
        }
        throw ctx.fail.parseFailure(`Could not parse Shanhe dashboard: ${error.message}`);
      }
      // A chart bug must never cost the user their windows.
      let recent = null;
      try {
        recent = recentUsage(response.optional, ctx);
      } catch {
        recent = null;
      }
      if (recent) snapshot.details.push(recent);
      return snapshot;
    }
    if (rejected) throw ctx.fail.authenticationExpired("Shanhe browser session expired. Sign in to api.0ki.cn again.");
    throw ctx.fail.missingCredential(
      `Sign in to api.0ki.cn/dashboard.php in ${ctx.browser.supportedBrowsers} before refreshing Shanhe usage.`,
    );
  },
});
