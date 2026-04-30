import { describe, it, expect, vi, beforeEach } from "vitest";

const queryMock = vi.fn();
vi.mock("./auth", () => ({
  litifyAuth: { getConnection: async () => ({ query: queryMock }) },
}));

beforeEach(async () => {
  queryMock.mockReset();
  vi.resetModules();
  const mod = await import("./case-type-cache");
  mod._resetCaseTypeCache();
});

describe("getLitifyCaseTypeId", () => {
  it("queries SOQL and returns ID for case type name", async () => {
    queryMock.mockResolvedValue({ records: [{ Id: "a0X123" }], totalSize: 1 });
    const { getLitifyCaseTypeId } = await import("./case-type-cache");
    const id = await getLitifyCaseTypeId("Workers' Compensation");
    expect(id).toBe("a0X123");
  });

  it("returns null when SOQL has no records", async () => {
    queryMock.mockResolvedValue({ records: [], totalSize: 0 });
    const { getLitifyCaseTypeId } = await import("./case-type-cache");
    const id = await getLitifyCaseTypeId("Nonexistent");
    expect(id).toBeNull();
  });

  it("uses cached value on second call", async () => {
    queryMock.mockResolvedValue({ records: [{ Id: "a0X123" }], totalSize: 1 });
    const { getLitifyCaseTypeId, _resetCaseTypeCache } = await import("./case-type-cache");
    _resetCaseTypeCache();
    await getLitifyCaseTypeId("Workers' Compensation");
    await getLitifyCaseTypeId("Workers' Compensation");
    expect(queryMock).toHaveBeenCalledTimes(1);
  });
});
