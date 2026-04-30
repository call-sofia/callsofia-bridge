import { describe, it, expect, vi, beforeEach } from "vitest";

const queryMock = vi.fn();
const createMock = vi.fn();

vi.mock("./auth", () => ({
  litifyAuth: {
    getConnection: async () => ({
      query: queryMock,
      sobject: () => ({ create: createMock }),
    }),
  },
}));

beforeEach(() => { queryMock.mockReset(); createMock.mockReset(); vi.resetModules(); });

describe("findByPhone", () => {
  it("returns person when SOQL match exists", async () => {
    queryMock.mockResolvedValue({ records: [{ Id: "p1", Name: "Janelle" }], totalSize: 1 });
    const { findByPhone } = await import("./person");
    const result = await findByPhone("+12132779473");
    expect(result?.Id).toBe("p1");
  });

  it("returns null when no match", async () => {
    queryMock.mockResolvedValue({ records: [], totalSize: 0 });
    const { findByPhone } = await import("./person");
    expect(await findByPhone("+10000000000")).toBeNull();
  });
});

describe("upsertByPhone", () => {
  it("returns existing if found", async () => {
    queryMock.mockResolvedValue({ records: [{ Id: "p1", Name: "Existing" }], totalSize: 1 });
    const { upsertByPhone } = await import("./person");
    const result = await upsertByPhone("+15555550001", { firstName: "Test", lastName: "User" });
    expect(result.Id).toBe("p1");
    expect(createMock).not.toHaveBeenCalled();
  });

  it("creates new if not found", async () => {
    queryMock.mockResolvedValue({ records: [], totalSize: 0 });
    createMock.mockResolvedValue({ id: "p2", success: true });
    const { upsertByPhone } = await import("./person");
    const result = await upsertByPhone("+15555550002", { firstName: "Test", lastName: "User" });
    expect(result.Id).toBe("p2");
    expect(createMock).toHaveBeenCalled();
  });
});
