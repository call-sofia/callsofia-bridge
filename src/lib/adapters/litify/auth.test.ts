import { describe, it, expect, vi, beforeEach } from "vitest";

// Capture the constructor args jsforce.Connection is built with so the
// token-exchange wiring can be asserted.
const ctorCalls: Array<Record<string, unknown>> = [];

vi.mock("jsforce", () => {
  class MockConnection {
    accessToken?: string;
    instanceUrl?: string;
    constructor(cfg: Record<string, unknown> = {}) {
      ctorCalls.push(cfg);
      this.accessToken = cfg.accessToken as string | undefined;
      this.instanceUrl = cfg.instanceUrl as string | undefined;
    }
    async query() {
      return { records: [{ Id: "u1" }], totalSize: 1 };
    }
  }
  return { default: { Connection: MockConnection }, Connection: MockConnection };
});

vi.mock("@/lib/config", () => ({
  config: () => ({
    salesforce: {
      loginUrl: "https://login.salesforce.com",
      clientId: "client_abc",
      clientSecret: "secret_xyz",
      // Legacy creds intentionally still set to verify deprecation warning path.
      username: "u",
      password: "p",
      securityToken: "t",
    },
  }),
}));

const fetchMock = vi.fn();
beforeEach(() => {
  ctorCalls.length = 0;
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
  vi.resetModules();
});

describe("LitifyAuth — OAuth Client Credentials Flow", () => {
  it("POSTs grant_type=client_credentials with form-encoded body to /services/oauth2/token", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: "tok_123",
          instance_url: "https://acme.my.salesforce.com",
          token_type: "Bearer",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const { LitifyAuth } = await import("./auth");
    const auth = new LitifyAuth();
    const conn = await auth.getConnection();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://login.salesforce.com/services/oauth2/token");
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    const body = init.body as string;
    expect(body).toContain("grant_type=client_credentials");
    expect(body).toContain("client_id=client_abc");
    expect(body).toContain("client_secret=secret_xyz");

    // The Connection should be constructed with the access token + instance URL
    // returned by the token endpoint — never with username/password.
    expect(ctorCalls[0]).toEqual({
      accessToken: "tok_123",
      instanceUrl: "https://acme.my.salesforce.com",
    });
    expect(conn.accessToken).toBe("tok_123");
  });

  it("throws when token exchange fails", async () => {
    fetchMock.mockResolvedValue(new Response("invalid_client", { status: 400 }));
    const { LitifyAuth } = await import("./auth");
    const auth = new LitifyAuth();
    await expect(auth.getConnection()).rejects.toThrow(/token exchange failed: 400/);
  });

  it("ping returns true on successful query", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ access_token: "tok_123", instance_url: "https://acme.my.salesforce.com" }),
        { status: 200 },
      ),
    );
    const { LitifyAuth } = await import("./auth");
    const auth = new LitifyAuth();
    expect(await auth.ping()).toBe(true);
  });

  it("withFreshConnection refreshes once on INVALID_SESSION_ID and retries", async () => {
    // Fresh Response per call — Response bodies are single-use.
    fetchMock.mockImplementation(async () => new Response(
      JSON.stringify({ access_token: "tok_v2", instance_url: "https://acme.my.salesforce.com" }),
      { status: 200 },
    ));
    const { LitifyAuth } = await import("./auth");
    const auth = new LitifyAuth();

    let calls = 0;
    const result = await auth.withFreshConnection(async () => {
      calls += 1;
      if (calls === 1) {
        const err = new Error("INVALID_SESSION_ID: Session expired") as Error & {
          errorCode?: string;
        };
        err.errorCode = "INVALID_SESSION_ID";
        throw err;
      }
      return "ok";
    });

    expect(result).toBe("ok");
    expect(calls).toBe(2);
    // initial getConnection + one refresh on 401
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
