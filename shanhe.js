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

function parseDashboard(html, pct) {
  const text = normalizeDashboard(html);
  if (!/账户余额/.test(text)) throw new Error("dashboard content is missing");
  const balance = dashboardNumber(text, /账户余额\s*¥?\s*([\d,]+(?:\.\d+)?)/, "balance");
  const requestBalance = dashboardNumber(text, /请求次数余额\s*([\d,]+)/, "request balance");
  const totalBilled = dashboardNumber(text, /累计计费次数\s*([\d,]+)/, "total billed requests");
  const monthlyBilled = dashboardNumber(text, /本月计费次数\s*([\d,]+)/, "monthly billed requests");
  const totalTokens = dashboardNumber(text, /Token\s*已用总数\s*([\d,]+)/i, "total tokens");
  const monthlyTokens = dashboardNumber(text, /Token\s*已用总数\s*[\d,]+\s*本月:\s*([\d,]+)/i, "monthly tokens");
  const concurrency = text.match(/并发数\s*([\d,]+)\s*\/\s*([\d,]+)/);
  const cycle = text.match(/本周期剩余\s*([\d,]+)\s*\/\s*([\d,]+)\s*次/);
  if (!cycle) throw new Error("missing cycle allowance");
  const remaining = Number(cycle[1].replace(/,/g, ""));
  const limit = Number(cycle[2].replace(/,/g, ""));
  if (!Number.isFinite(remaining) || !Number.isFinite(limit) || limit <= 0 || remaining < 0 || remaining > limit) {
    throw new Error("invalid cycle allowance");
  }
  const reset = text.match(/((?:\d+\s*天)?\s*(?:\d+\s*小时)?\s*(?:\d+\s*分钟)?\s*)后重置/);
  const period = text.match(/每期\s*([\d,]+)\s*次/);
  const monthlyLimit = text.match(/每月\s*([\d,]+)\s*次/);
  const expiry = text.match(/有效期至[:：]\s*([\d.-]+)/);
  const used = limit - remaining;
  const rows = [
    { label: "Account balance", value: `¥${balance.toFixed(2)}` },
    { label: "Request balance", value: String(requestBalance) },
    { label: "Total billed requests", value: String(totalBilled) },
    { label: "Billed requests this month", value: String(monthlyBilled) },
    { label: "Total tokens", value: String(totalTokens) },
    { label: "Tokens this month", value: String(monthlyTokens) },
    { label: "Cycle remaining", value: `${remaining} / ${limit}` },
  ];
  if (period) rows.push({ label: "Per-period allowance", value: period[1] });
  if (monthlyLimit) rows.push({ label: "Monthly allowance", value: monthlyLimit[1] });
  if (reset) rows.push({ label: "Reset", value: `${reset[1].trim()} remaining` });
  if (expiry) rows.push({ label: "Plan expiry", value: expiry[1] });
  if (concurrency) rows.push({ label: "Concurrency", value: `${concurrency[1]} / ${concurrency[2]}` });
  return {
    primary: {
      usedPercent: pct(used, limit),
      resetDescription: `${remaining} / ${limit}${reset ? ` · ${reset[1].trim()} remaining` : ""}`,
    },
    details: [{ title: "Shanhe dashboard", rows }],
    identity: { loginMethod: "Browser session" },
    dataConfidence: "exact",
  };
}

defineProvider({
  id: "shanhe",
  name: "Shanhe",
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
        const snapshot = parseDashboard(response.bodyText, ctx.pct);
        return snapshot;
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
