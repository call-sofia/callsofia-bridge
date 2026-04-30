import { describe, it, expect, vi, beforeEach } from "vitest";

const fetchMock = vi.fn();
global.fetch = fetchMock as unknown as typeof fetch;

vi.mock("@/lib/config", () => ({
  config: () => ({ genericWebhook: { url: "https://hooks.example.com/test", secret: undefined, transform: "litify-shape" } }),
}));

beforeEach(() => { fetchMock.mockReset(); vi.resetModules(); });

const ev = (overrides: Record<string, unknown> = {}) => ({
  event_id: "e1", event_type: "lead.qualified" as const, emitted_at: "2026-04-29T13:00:00Z", schema_version: 2 as const,
  data: { scope: { org_id: "o", workspace_id: "w", pipeline_id: "p", stage_id: null }, payload: { call_id: "c" } },
  ...overrides,
});

describe("GenericWebhookAdapter", () => {
  it("POSTs transformed event on success", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
    const { GenericWebhookAdapter } = await import("./adapter");
    const a = new GenericWebhookAdapter(); await a.init();
    const result = await a.handle(ev() as never, {} as never);
    expect(result.outcome).toBe("success");
    expect(fetchMock).toHaveBeenCalled();
  });

  it("returns failure on 4xx", async () => {
    fetchMock.mockResolvedValue(new Response("bad", { status: 400 }));
    const { GenericWebhookAdapter } = await import("./adapter");
    const a = new GenericWebhookAdapter(); await a.init();
    const result = await a.handle(ev() as never, {} as never);
    expect(result.outcome).toBe("failure");
  });

  it("returns retry on 5xx", async () => {
    fetchMock.mockResolvedValue(new Response("oops", { status: 503 }));
    const { GenericWebhookAdapter } = await import("./adapter");
    const a = new GenericWebhookAdapter(); await a.init();
    const result = await a.handle(ev() as never, {} as never);
    expect(result.outcome).toBe("retry");
  });

  it("returns retry on network error", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));
    const { GenericWebhookAdapter } = await import("./adapter");
    const a = new GenericWebhookAdapter(); await a.init();
    const result = await a.handle(ev() as never, {} as never);
    expect(result.outcome).toBe("retry");
  });
});
