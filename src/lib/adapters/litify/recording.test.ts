import { describe, it, expect, vi, beforeEach } from "vitest";

const fetchMock = vi.fn();
global.fetch = fetchMock as unknown as typeof fetch;

const createMock = vi.fn();
vi.mock("./auth", () => ({
  litifyAuth: { getConnection: async () => ({ sobject: () => ({ create: createMock }) }) },
}));

beforeEach(() => { fetchMock.mockReset(); createMock.mockReset(); vi.resetModules(); });

describe("attachRecordingToIntake", () => {
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
