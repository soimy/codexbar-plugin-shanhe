// Shanhe sells 5-hour periods ("每 5 小时 N 次") on top of a monthly cap; the dashboard prints the
// per-period and monthly limits, so only the period length is pinned here.
const PERIOD_WINDOW_MINUTES = 300;
// 30 days, the monthly-window convention the bundled providers use.
const MONTH_WINDOW_MINUTES = 43200;

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

// The dashboard pairs every allowance with its remaining count, e.g. "请求次数余额 1,567 / 1,800"
// and "本周期剩余 25,587 / 30,000 次". Both numbers come from the page; neither limit is pinned.
function dashboardAllowance(text, pattern, label) {
  const match = pattern.exec(text);
  if (!match) throw new Error(`missing ${label}`);
  const remaining = Number(match[1].replace(/,/g, ""));
  const limit = Number(match[2].replace(/,/g, ""));
  if (!Number.isFinite(remaining) || !Number.isFinite(limit) || limit <= 0 || remaining < 0 || remaining > limit) {
    throw new Error(`invalid ${label}`);
  }
  return { remaining, limit };
}

// "0小时14分钟后重置" / "1天2小时后重置" -> { totalMinutes, label: "14m" | "1d 2h" }.
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

function parseDashboard(html, host) {
  const text = normalizeDashboard(html);
  if (!/账户余额/.test(text)) throw new Error("dashboard content is missing");
  const format = (value) => host.format.number(value);
  const balance = dashboardNumber(text, /账户余额\s*¥?\s*([\d,]+(?:\.\d+)?)/, "balance");
  const totalBilled = dashboardNumber(text, /累计计费次数\s*([\d,]+)/, "total billed requests");
  const monthlyBilled = dashboardNumber(text, /本月计费次数\s*([\d,]+)/, "monthly billed requests");
  const totalTokens = dashboardNumber(text, /Token\s*已用总数\s*([\d,]+)/i, "total tokens");
  const monthlyTokens = dashboardNumber(text, /Token\s*已用总数\s*[\d,]+\s*本月:\s*([\d,]+)/i, "monthly tokens");
  const period = dashboardAllowance(text, /请求次数余额\s*([\d,]+)\s*\/\s*([\d,]+)/, "period allowance");
  const month = dashboardAllowance(text, /本周期剩余\s*([\d,]+)\s*\/\s*([\d,]+)\s*次/, "monthly allowance");
  const countdown = dashboardCountdown(text);
  const concurrency = text.match(/并发数\s*([\d,]+)\s*\/\s*([\d,]+)/);
  const expiry = text.match(/有效期至[:：]\s*([\d.-]+)/);
  const periodUsed = period.limit - period.remaining;
  const monthUsed = month.limit - month.remaining;

  // `primary` is the 5-hour period: it drives the menu bar / Overview percent by default.
  const primary = {
    usedPercent: host.pct(periodUsed, period.limit),
    windowMinutes: PERIOD_WINDOW_MINUTES,
    resetDescription: `${format(period.remaining)} / ${format(period.limit)} left`,
  };
  if (countdown) {
    primary.resetsAt = host.date.unixMillis(host.date.nowMillis() + countdown.totalMinutes * 60000);
    primary.resetDescription += ` · resets in ${countdown.label}`;
  }

  const windowRows = [
    { label: "5-hour period", value: `${format(periodUsed)} / ${format(period.limit)} used` },
    { label: "This month", value: `${format(monthUsed)} / ${format(month.limit)} used` },
  ];
  if (countdown) windowRows.push({ label: "Period resets", value: `${countdown.label} left` });
  // The dashboard prints no monthly reset time; the plan follows the calendar month.
  windowRows.push({ label: "Monthly reset", value: "Calendar month" });

  const accountRows = [
    { label: "Account balance", value: `¥${balance.toFixed(2)}` },
    { label: "Total billed requests", value: format(totalBilled) },
    { label: "Billed requests this month", value: format(monthlyBilled) },
    { label: "Total tokens", value: format(totalTokens) },
    { label: "Tokens this month", value: format(monthlyTokens) },
  ];
  if (concurrency) accountRows.push({ label: "Concurrency", value: `${concurrency[1]} / ${concurrency[2]}` });
  if (expiry) accountRows.push({ label: "Plan expiry", value: expiry[1] });

  return {
    primary,
    // `secondary` is the monthly allowance; it is user-selectable as the menu bar metric.
    secondary: {
      usedPercent: host.pct(monthUsed, month.limit),
      windowMinutes: MONTH_WINDOW_MINUTES,
      resetDescription: "Resets with the calendar month",
    },
    details: [
      { title: "Usage windows", rows: windowRows },
      { title: "Account", rows: accountRows },
    ],
    identity: { loginMethod: "Browser session" },
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
      const response = await ctx.http.get("https://api.0ki.cn/dashboard.php", {
        headers: { Cookie: session.header },
      });
      if (response.status === 401 || response.status === 403 || response.status === 301 || response.status === 302) {
        ctx.browser.rejectCookie(domain, session);
        rejected = true;
        continue;
      }
      if (response.status === 429) throw ctx.fail.rateLimited("Shanhe dashboard requests are rate limited.");
      if (response.status >= 500) throw ctx.fail.providerUnavailable(`Shanhe dashboard returned HTTP ${response.status}.`);
      if (response.status !== 200) throw ctx.fail.apiFailure(`Shanhe dashboard returned HTTP ${response.status}.`);
      try {
        return parseDashboard(response.bodyText, ctx);
      } catch (error) {
        if (/登录|login/i.test(response.bodyText) && !/账户余额/.test(response.bodyText)) {
          ctx.browser.rejectCookie(domain, session);
          rejected = true;
          continue;
        }
        throw ctx.fail.parseFailure(`Could not parse Shanhe dashboard: ${error.message}`);
      }
    }
    if (rejected) throw ctx.fail.authenticationExpired("Shanhe browser session expired. Sign in to api.0ki.cn again.");
    throw ctx.fail.missingCredential(
      `Sign in to api.0ki.cn/dashboard.php in ${ctx.browser.supportedBrowsers} before refreshing Shanhe usage.`,
    );
  },
});
