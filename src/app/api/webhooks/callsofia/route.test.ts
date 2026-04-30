import { describe, it, expect, vi, beforeEach } from "vitest";
import crypto from "crypto";

vi.mock("@/lib/db/client", () => ({
  db: { insert: () => ({ values: () => ({ onConflictDoNothing: async () => undefined }) }) },
  schema: { events: {} },
}));
vi.mock("@/lib/queue/publisher", () => ({ publishEventForProcessing: vi.fn(async () => undefined) }));
vi.mock("@/lib/platform-api/client", () => ({ platformApi: { logActivity: vi.fn(async () => undefined) } }));
vi.mock("@/lib/redis/client", () => ({ idempotency: { claim: vi.fn(async () => true) } }));

const SECRET = "whsec_" + crypto.randomBytes(8).toString("hex");
process.env.CALLSOFIA_WEBHOOK_SECRET = SECRET;
process.env.CALLSOFIA_API_BASE_URL = "https://api.callsofia.co";
process.env.CALLSOFIA_ORG_ID = "10000000-0000-0000-0000-000000000001";
process.env.CALLSOFIA_API_KEY = "k_test_xxx";
process.env.DATABASE_URL = "postgres://localhost/x";
process.env.REDIS_URL = "https://test.upstash.io";
process.env.CRM_ADAPTER = "litify";
process.env.SALESFORCE_LOGIN_URL = "https://login.salesforce.com";
process.env.SALESFORCE_CLIENT_ID = "x";
process.env.SALESFORCE_CLIENT_SECRET = "y";
process.env.SALESFORCE_USERNAME = "u";
process.env.SALESFORCE_PASSWORD = "p";
process.env.SALESFORCE_SECURITY_TOKEN = "t";
process.env.ADMIN_PASSWORD = "adminadmin";

function sign(body: string, ts: string): string {
  return "sha256=" + crypto.createHmac("sha256", SECRET).update(`${ts}.${body}`).digest("hex");
}

const validBody = (overrides: Record<string, unknown> = {}) => JSON.stringify({
  event_id: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  event_type: "call.ended",
  emitted_at: new Date().toISOString(),
  schema_version: 2,
  data: {
    scope: { org_id: "10000000-0000-0000-0000-000000000001", workspace_id: "20000000-0000-0000-0000-000000000001", pipeline_id: "80000000-0000-0000-0000-000000000001", stage_id: null },
    payload: {},
  },
  ...overrides,
});

beforeEach(() => { vi.clearAllMocks(); });

describe("POST /api/webhooks/callsofia", () => {
  it("returns 200 for valid signed request", async () => {
    const { POST } = await import("./route");
    const body = validBody();
    const ts = new Date().toISOString();
    const req = new Request("http://x/api/webhooks/callsofia", {
      method: "POST", body,
      headers: { "content-type": "application/json", "x-callsofia-timestamp": ts, "x-callsofia-signature": sign(body, ts) },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
  });

  it("returns 401 for invalid signature", async () => {
    const { POST } = await import("./route");
    const req = new Request("http://x/api/webhooks/callsofia", {
      method: "POST", body: "{}",
      headers: { "content-type": "application/json", "x-callsofia-timestamp": new Date().toISOString(), "x-callsofia-signature": "sha256=00" },
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("returns 400 for stale timestamp", async () => {
    const { POST } = await import("./route");
    const body = validBody();
    const oldTs = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const req = new Request("http://x/api/webhooks/callsofia", {
      method: "POST", body,
      headers: { "content-type": "application/json", "x-callsofia-timestamp": oldTs, "x-callsofia-signature": sign(body, oldTs) },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});
