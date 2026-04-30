import { describe, it, expect, beforeEach } from "vitest";

describe("config", () => {
  beforeEach(() => {
    process.env = { ...process.env };
  });

  it("parses required env vars", async () => {
    process.env.CALLSOFIA_API_BASE_URL = "https://api.callsofia.co";
    process.env.CALLSOFIA_ORG_ID = "10000000-0000-0000-0000-000000000001";
    process.env.CALLSOFIA_API_KEY = "sk_prod_test_xxx";
    process.env.CALLSOFIA_WEBHOOK_SECRET = "whsec_xxx";
    process.env.DATABASE_URL = "postgres://localhost/test";
    process.env.REDIS_URL = "https://test.upstash.io";
    process.env.CRM_ADAPTER = "litify";
    process.env.SALESFORCE_LOGIN_URL = "https://login.salesforce.com";
    process.env.SALESFORCE_CLIENT_ID = "x";
    process.env.SALESFORCE_CLIENT_SECRET = "y";
    process.env.SALESFORCE_USERNAME = "u";
    process.env.SALESFORCE_PASSWORD = "p";
    process.env.SALESFORCE_SECURITY_TOKEN = "t";
    process.env.ADMIN_PASSWORD = "adminadmin";

    const { loadConfig } = await import("./config");
    const cfg = loadConfig();
    expect(cfg.callsofia.orgId).toBe("10000000-0000-0000-0000-000000000001");
    expect(cfg.crmAdapter).toBe("litify");
  });

  it("throws on missing required vars", async () => {
    delete process.env.CALLSOFIA_WEBHOOK_SECRET;
    const { loadConfig } = await import("./config");
    expect(() => loadConfig()).toThrow();
  });
});
