defineProvider({
  id: "shanhe",
  name: "Shanhe",
  endpoints: ["https://api.0ki.cn", { setting: "SHANHE_BASE_URL", policy: "https" }],
  auth: { type: "bearer", secret: "SHANHE_API_KEY" },
  settings: [
    { key: "SHANHE_API_KEY", title: "Shanhe API key", type: "secure" },
    { key: "SHANHE_BASE_URL", title: "Base URL", subtitle: "Defaults to https://api.0ki.cn", type: "plain" },
    { key: "SHANHE_USAGE_PATH", title: "Usage path", subtitle: "Defaults to /v1/usage", type: "plain" },
  ],
  capabilities: ["http-status"],

  async fetchUsage(ctx) {
    const base = (ctx.settings.get("SHANHE_BASE_URL") || "https://api.0ki.cn").replace(/\/+$/, "");
    const path = ctx.settings.get("SHANHE_USAGE_PATH") || "/v1/usage";
    const response = await ctx.http.get(`${base}/${path.replace(/^\/+/, "")}`);
    const message = `Shanhe returned HTTP ${response.status}.`;
    if (response.status === 401) throw ctx.fail.authenticationExpired(message);
    if (response.status === 403) throw ctx.fail.permissionDenied(message);
    if (response.status === 402) throw ctx.fail.apiFailure("Shanhe account quota is exhausted.");
    if (response.status === 429) throw ctx.fail.rateLimited(message);
    if (response.status >= 500) throw ctx.fail.providerUnavailable(message);
    if (response.status < 200 || response.status >= 300) throw ctx.fail.apiFailure(message);

    let payload;
    try { payload = JSON.parse(response.bodyText); } catch { throw ctx.fail.parseFailure("Shanhe usage response is not valid JSON."); }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw ctx.fail.parseFailure("Shanhe usage response must be an object.");
    }

    // Accept the common shapes while the vendor response contract is finalized.
    const source = payload.usage && typeof payload.usage === "object" ? payload.usage : payload;
    const used = Number(source.used ?? source.consumed ?? source.spent);
    const limit = Number(source.limit ?? source.total ?? source.quota ?? source.maximum);
    if (!Number.isFinite(used) || !Number.isFinite(limit) || limit <= 0 || used < 0) {
      throw ctx.fail.parseFailure("Shanhe usage response lacks numeric used and limit fields.");
    }
    const resetsAt = source.resetsAt || source.reset_at || source.resetAt;
    return {
      primary: {
        usedPercent: ctx.pct(used, limit),
        resetDescription: `${used} / ${limit}`,
        resetsAt: typeof resetsAt === "string" ? ctx.date.iso(resetsAt) : null,
      },
      identity: { loginMethod: "API key" },
      dataConfidence: "exact",
    };
  },
});
