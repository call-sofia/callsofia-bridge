import { describe, it, expect, vi, beforeEach } from "vitest";

const fetchMock = vi.fn();
global.fetch = fetchMock as unknown as typeof fetch;

beforeEach(() => {
  fetchMock.mockReset();
  process.env.CALLSOFIA_API_BASE_URL = "https://api.callsofia.co";
  process.env.CALLSOFIA_API_KEY = "sk_test_xxx";
  process.env.CALLSOFIA_ORG_ID = "10000000-0000-0000-0000-000000000001";
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
  vi.resetModules();
});

describe("PlatformApiClient.logActivity", () => {
  it("POSTs to /v1/logs with X-API-Key and translated body when MIRROR_TO_PLATFORM_API not false", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 202 }));
    const { platformApi } = await import("./client");
    await platformApi.logActivity({ type: "bridge.event_received", severity: "info", event_data: { foo: "bar" } });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.callsofia.co/v1/logs");
    expect(init.headers["X-API-Key"]).toBe("sk_test_xxx");
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      level: 200,
      category: "webhook",
      event_type: "bridge.event_received",
      source: "callsofia-bridge",
      metadata: { foo: "bar" },
    });
  });

  it("getCallDetail GETs the correct path", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: "c1" }), { status: 200 }));
    const { platformApi } = await import("./client");
    const result = await platformApi.getCallDetail("c1");
    expect(result.id).toBe("c1");
    expect(fetchMock.mock.calls[0][0]).toContain("/v1/calls/c1");
  });

  it("logActivity skipped when MIRROR_TO_PLATFORM_API=false", async () => {
    process.env.MIRROR_TO_PLATFORM_API = "false";
    const { platformApi } = await import("./client");
    await platformApi.logActivity({ type: "x", severity: "info", event_data: {} });
    expect(fetchMock).not.toHaveBeenCalled();
    delete process.env.MIRROR_TO_PLATFORM_API;
  });
});
