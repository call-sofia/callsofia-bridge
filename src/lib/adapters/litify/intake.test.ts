import { describe, it, expect, vi } from "vitest";

const queryMock = vi.fn();
const createMock = vi.fn();
const updateMock = vi.fn();
const upsertMock = vi.fn();

vi.mock("./auth", () => ({
  litifyAuth: { getConnection: async () => ({ query: queryMock, sobject: () => ({ create: createMock, update: updateMock, upsert: upsertMock }) }) },
}));
vi.mock("./case-type-cache", () => ({ getLitifyCaseTypeId: async () => "ct1" }));
vi.mock("@/lib/config", () => ({
  config: () => ({ litify: { intakeDefaultOwnerId: undefined, intakeRecordTypeId: undefined } }),
}));

describe("LitifyIntake.create", () => {
  it("creates intake with case type lookup", async () => {
    createMock.mockResolvedValue({ id: "i1", success: true });
    const { createIntake } = await import("./intake");
    const result = await createIntake({
      personId: "p1",
      callId: "c1",
      callerPhone: "+1",
      startedAt: "2026-04-29T13:00:00Z",
      endedAt: "2026-04-29T13:17:00Z",
      duration: 1020,
      language: "en",
      caseType: "Workers' Compensation",
      twilioSid: "CA1",
    });
    expect(result.id).toBe("i1");
  });
});

describe("LitifyIntake.findByCallId", () => {
  it("looks up by external ID", async () => {
    queryMock.mockResolvedValue({ records: [{ Id: "i1" }], totalSize: 1 });
    const { findByCallId } = await import("./intake");
    expect((await findByCallId("c1"))?.Id).toBe("i1");
  });
});
