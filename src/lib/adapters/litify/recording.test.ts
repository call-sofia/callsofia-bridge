import { describe, it, expect, vi, beforeEach } from "vitest";

const fetchMock = vi.fn();
global.fetch = fetchMock as unknown as typeof fetch;

const createMock = vi.fn();
const updateMock = vi.fn();
const mockConn = { sobject: () => ({ create: createMock, update: updateMock }) };
vi.mock("./auth", () => ({
  litifyAuth: {
    getConnection: async () => mockConn,
    withFreshConnection: async (fn: (c: typeof mockConn) => Promise<unknown>) => fn(mockConn),
  },
}));

let recordingMode: "url" | "attach" = "url";
vi.mock("@/lib/config", () => ({
  config: () => ({ litify: { recordingMode } }),
}));

beforeEach(() => {
  fetchMock.mockReset();
  createMock.mockReset();
  updateMock.mockReset();
  recordingMode = "url";
  vi.resetModules();
});

describe("attachRecordingToIntake — default `url` mode", () => {
  it("writes the URL to the Intake without downloading the file", async () => {
    updateMock.mockResolvedValue({ id: "i1", success: true });

    const { attachRecordingToIntake } = await import("./recording");
    const result = await attachRecordingToIntake({
      intakeId: "i1",
      downloadUrl: "https://s3.amazonaws.com/bucket/recording.ogg",
      callId: "c1",
    });

    expect(result.mode).toBe("url");
    expect(result.contentVersionId).toBeNull();
    expect(result.intakeId).toBe("i1");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({
      Id: "i1",
      CallSofia_Recording_URL__c: "https://s3.amazonaws.com/bucket/recording.ogg",
    }));
  });
});

describe("attachRecordingToIntake — `attach` mode (legacy, opt-in)", () => {
  beforeEach(() => { recordingMode = "attach"; });

  it("downloads and uploads as ContentVersion", async () => {
    fetchMock.mockResolvedValue(new Response(new ArrayBuffer(1024), { status: 200 }));
    createMock.mockResolvedValue({ id: "069xxx", success: true });

    const { attachRecordingToIntake } = await import("./recording");
    const result = await attachRecordingToIntake({
      intakeId: "i1",
      downloadUrl: "https://s3.amazonaws.com/bucket/recording.ogg",
      callId: "c1",
    });
    expect(result.contentVersionId).toBe("069xxx");
    expect(result.mode).toBe("attach");
    expect(fetchMock).toHaveBeenCalledWith("https://s3.amazonaws.com/bucket/recording.ogg");
    expect(createMock).toHaveBeenCalledWith(expect.objectContaining({
      Title: expect.stringContaining("c1"),
      FirstPublishLocationId: "i1",
    }));
  });

  it("throws on download failure", async () => {
    fetchMock.mockResolvedValue(new Response("nope", { status: 403 }));
    const { attachRecordingToIntake } = await import("./recording");
    await expect(attachRecordingToIntake({ intakeId: "i1", downloadUrl: "https://x", callId: "c1" }))
      .rejects.toThrow(/download failed/);
  });
});
