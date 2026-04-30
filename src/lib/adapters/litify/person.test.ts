import { describe, it, expect, vi, beforeEach } from "vitest";

const findOneMock = vi.fn();
const createMock = vi.fn();

const mockConn = { sobject: () => ({ findOne: findOneMock, create: createMock }) };
vi.mock("./auth", () => ({
  litifyAuth: {
    getConnection: async () => mockConn,
    withFreshConnection: async (fn: (c: typeof mockConn) => Promise<unknown>) => fn(mockConn),
  },
}));

beforeEach(() => { findOneMock.mockReset(); createMock.mockReset(); vi.resetModules(); });

describe("findByPhone", () => {
  it("uses parameterized findOne with the phone condition", async () => {
    findOneMock.mockResolvedValue({ Id: "p1", Name: "Janelle" });
    const { findByPhone } = await import("./person");
    const result = await findByPhone("+12132779473");
    expect(result?.Id).toBe("p1");
    expect(findOneMock).toHaveBeenCalledWith({ Phone: "+12132779473" }, ["Id", "Name", "Phone"]);
  });

  it("returns null when no match", async () => {
    findOneMock.mockResolvedValue(null);
    const { findByPhone } = await import("./person");
    expect(await findByPhone("+10000000000")).toBeNull();
  });

  it("does not interpolate phone into a SOQL string (injection-safe)", async () => {
    findOneMock.mockResolvedValue(null);
    const { findByPhone } = await import("./person");
    // Phone with a single quote that previously needed manual escaping
    await findByPhone("+1'; DROP TABLE--");
    // The condition object passes the raw value to jsforce; no SOQL string is built here.
    expect(findOneMock).toHaveBeenCalledWith({ Phone: "+1'; DROP TABLE--" }, expect.any(Array));
  });
});

describe("upsertByPhone", () => {
  it("returns existing if found", async () => {
    findOneMock.mockResolvedValue({ Id: "p1", Name: "Existing" });
    const { upsertByPhone } = await import("./person");
    const result = await upsertByPhone("+15555550001", { firstName: "Test", lastName: "User" });
    expect(result.Id).toBe("p1");
    expect(createMock).not.toHaveBeenCalled();
  });

  it("creates new if not found", async () => {
    findOneMock.mockResolvedValue(null);
    createMock.mockResolvedValue({ id: "p2", success: true });
    const { upsertByPhone } = await import("./person");
    const result = await upsertByPhone("+15555550002", { firstName: "Test", lastName: "User" });
    expect(result.Id).toBe("p2");
    expect(createMock).toHaveBeenCalled();
  });
});
