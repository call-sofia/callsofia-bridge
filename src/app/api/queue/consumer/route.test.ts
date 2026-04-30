import { describe, it, expect, vi } from "vitest";

const handleMock = vi.fn();
vi.mock("@/lib/adapters/registry", () => ({
  selectAdapterName: () => "litify",
  getAdapter: async () => ({ name: "litify", handle: handleMock }),
}));
const insertValuesMock = vi.fn();
const updateSetMock = vi.fn();
vi.mock("@/lib/db/client", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [
            {
              eventId: "e1",
              eventType: "call.ended",
              payload: {},
              scope: {},
              emittedAt: new Date(),
              schemaVersion: 2,
            },
          ],
        }),
      }),
    }),
    insert: () => ({ values: insertValuesMock }),
    update: () => ({ set: updateSetMock }),
  },
  schema: { events: {}, deliveries: {} },
}));
vi.mock("@/lib/config", () => ({
  config: () => ({
    crmAdapter: "litify",
    reliability: { maxRetries: 10, retryBaseDelayMs: 1000, retryMaxDelayMs: 60000 },
    handlers: { callEnded: true },
  }),
}));
vi.mock("@/lib/platform-api/client", () => ({
  platformApi: { logActivity: vi.fn(async () => undefined) },
}));
vi.mock("@/lib/queue/publisher", () => ({
  publishEventForProcessing: vi.fn(async () => undefined),
}));

describe("POST /api/queue/consumer", () => {
  it("processes event and persists delivery", async () => {
    handleMock.mockResolvedValue({ outcome: "success", crm_record_id: "i1" });
    insertValuesMock.mockReturnValue({ onConflictDoNothing: async () => undefined });
    updateSetMock.mockReturnValue({ where: async () => undefined });

    const { POST } = await import("./route");
    const req = new Request("http://x/api/queue/consumer", {
      method: "POST",
      body: JSON.stringify({ event_id: "e1", attempt: 1 }),
      headers: {
        "content-type": "application/json",
        "x-queue-token": process.env.QUEUE_INTERNAL_TOKEN ?? "",
      },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(handleMock).toHaveBeenCalled();
  });
});
