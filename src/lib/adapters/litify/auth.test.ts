import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("jsforce", () => {
  return {
    default: { Connection: class {
      accessToken = "mock_token";
      instanceUrl = "https://mock.my.salesforce.com";
      async login() { return { id: "x", organizationId: "y" }; }
      async query() { return { records: [{ Id: "u1" }], totalSize: 1 }; }
    }},
    Connection: class {
      accessToken = "mock_token";
      instanceUrl = "https://mock.my.salesforce.com";
      async login() { return { id: "x", organizationId: "y" }; }
      async query() { return { records: [{ Id: "u1" }], totalSize: 1 }; }
    },
  };
});

vi.mock("@/lib/config", () => ({
  config: () => ({
    salesforce: { loginUrl: "https://login.salesforce.com", clientId: "c", clientSecret: "s", username: "u", password: "p", securityToken: "t" },
  }),
}));

beforeEach(() => { vi.resetModules(); });

describe("LitifyAuth", () => {
  it("getConnection returns a logged-in connection", async () => {
    const { LitifyAuth } = await import("./auth");
    const auth = new LitifyAuth();
    const conn = await auth.getConnection();
    expect(conn.accessToken).toBe("mock_token");
  });

  it("ping returns true on successful query", async () => {
    const { LitifyAuth } = await import("./auth");
    const auth = new LitifyAuth();
    expect(await auth.ping()).toBe(true);
  });
});
