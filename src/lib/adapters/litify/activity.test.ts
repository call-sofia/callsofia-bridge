import { describe, it, expect, vi, beforeEach } from "vitest";

const findOneMock = vi.fn();
const createMock = vi.fn();
const updateMock = vi.fn();

vi.mock("./auth", () => ({
  litifyAuth: {
    getConnection: async () => ({
      sobject: () => ({ findOne: findOneMock, create: createMock, update: updateMock }),
    }),
  },
}));

beforeEach(() => { findOneMock.mockReset(); createMock.mockReset(); updateMock.mockReset(); vi.resetModules(); });

describe("startInboundCall", () => {
  it("creates Task with correct fields", async () => {
    createMock.mockResolvedValue({ id: "t1", success: true });
    const { startInboundCall } = await import("./activity");
    const result = await startInboundCall({ personId: "p1", callId: "c1", twilioSid: "CA1" });
    expect(result.id).toBe("t1");
    expect(createMock).toHaveBeenCalledWith(expect.objectContaining({
      Subject: expect.any(String),
      Status: "In Progress",
      Type: "Call",
      WhoId: "p1",
      CallSofia_Call_ID__c: "c1",
    }));
  });
});

describe("completeCall", () => {
  it("updates existing Task to Completed (parameterized lookup)", async () => {
    findOneMock.mockResolvedValue({ Id: "t1" });
    updateMock.mockResolvedValue({ id: "t1", success: true });
    const { completeCall } = await import("./activity");
    await completeCall({ callId: "c1", duration: 1020, intakeId: "i1" });
    expect(findOneMock).toHaveBeenCalledWith(
      { CallSofia_Call_ID__c: "c1" },
      ["Id"],
    );
    expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({
      Id: "t1",
      Status: "Completed",
      WhatId: "i1",
    }));
  });

  it("no-ops gracefully when Task not found", async () => {
    findOneMock.mockResolvedValue(null);
    const { completeCall } = await import("./activity");
    await completeCall({ callId: "missing", duration: 0, intakeId: "i1" });
    expect(updateMock).not.toHaveBeenCalled();
  });
});
