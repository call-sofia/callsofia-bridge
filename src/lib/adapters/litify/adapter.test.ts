import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./auth", () => ({
  litifyAuth: {
    getConnection: vi.fn(async () => ({})),
    ping: vi.fn(async () => true),
  },
}));

vi.mock("./person", () => ({
  findByPhone: vi.fn(async (phone: string) =>
    phone === "+12132779473" ? { Id: "p1", Name: "Existing" } : null,
  ),
  upsertByPhone: vi.fn(async () => ({ Id: "p1", Name: "Existing" })),
}));

vi.mock("./activity", () => ({
  startInboundCall: vi.fn(async () => ({ id: "t1" })),
  completeCall: vi.fn(async () => undefined),
  appendNote: vi.fn(async () => undefined),
}));

vi.mock("./intake", () => ({
  findByCallId: vi.fn(async () => ({ Id: "i1" })),
  createIntake: vi.fn(async () => ({ id: "i1" })),
  upsertByCallId: vi.fn(async () => ({ id: "i1" })),
  attachRecording: vi.fn(async () => "i1"),
  triggerConversionFlow: vi.fn(async () => undefined),
}));

vi.mock("./recording", () => ({
  attachRecordingToIntake: vi.fn(async () => ({
    contentVersionId: "cv1",
    contentDocumentId: null,
  })),
}));

vi.mock("./field-mapping", () => ({
  mapCaseType: (s: string) => s,
  mapStatus: (s: string) => s,
  mapLanguage: (s: string) => s,
  mapExtractedVars: (v: Record<string, unknown>) => v,
}));

vi.mock("@/lib/config", () => ({
  config: () => ({
    litify: {
      autoConvertQualified: false,
      intakeCoordinatorUserId: "u1",
    },
  }),
}));

const ev = (type: string, payload: Record<string, unknown> = {}) => ({
  event_id: "e",
  event_type: type as never,
  emitted_at: "2026-04-29T13:00:00Z",
  schema_version: 2 as const,
  data: {
    scope: { org_id: "o", workspace_id: "w", pipeline_id: "p", stage_id: null },
    payload,
  },
});

describe("LitifyAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("has name 'litify'", async () => {
    const { LitifyAdapter } = await import("./adapter");
    const a = new LitifyAdapter();
    expect(a.name).toBe("litify");
  });

  describe("init", () => {
    it("warms the Salesforce connection", async () => {
      const { LitifyAdapter } = await import("./adapter");
      const auth = await import("./auth");
      const a = new LitifyAdapter();
      await a.init();
      expect(auth.litifyAuth.getConnection).toHaveBeenCalled();
    });
  });

  describe("healthCheck", () => {
    it("returns healthy: true when ping succeeds", async () => {
      const { LitifyAdapter } = await import("./adapter");
      const auth = await import("./auth");
      vi.mocked(auth.litifyAuth.ping).mockResolvedValueOnce(true);
      const a = new LitifyAdapter();
      const result = await a.healthCheck();
      expect(result.healthy).toBe(true);
    });

    it("returns healthy: false when ping fails", async () => {
      const { LitifyAdapter } = await import("./adapter");
      const auth = await import("./auth");
      vi.mocked(auth.litifyAuth.ping).mockResolvedValueOnce(false);
      const a = new LitifyAdapter();
      const result = await a.healthCheck();
      expect(result.healthy).toBe(false);
    });
  });

  describe("handle", () => {
    it("call.ringing with known caller creates a Task", async () => {
      const { LitifyAdapter } = await import("./adapter");
      const Activity = await import("./activity");
      const a = new LitifyAdapter();
      const r = await a.handle(
        ev("call.ringing", {
          call_id: "c1",
          from_phone: "+12132779473",
          twilio_call_sid: "CA1",
        }),
        {} as never,
      );
      expect(r.outcome).toBe("success");
      expect(r.crm_record_id).toBe("t1");
      expect(Activity.startInboundCall).toHaveBeenCalled();
    });

    it("call.ringing with unknown caller returns noop", async () => {
      const { LitifyAdapter } = await import("./adapter");
      const a = new LitifyAdapter();
      const r = await a.handle(
        ev("call.ringing", {
          call_id: "c1",
          from_phone: "+19999999999",
          twilio_call_sid: "CA1",
        }),
        {} as never,
      );
      expect(r.outcome).toBe("noop");
    });

    it("call.ended creates Person + Intake and completes call", async () => {
      const { LitifyAdapter } = await import("./adapter");
      const Person = await import("./person");
      const Intake = await import("./intake");
      const Activity = await import("./activity");
      const a = new LitifyAdapter();
      const r = await a.handle(
        ev("call.ended", {
          call_id: "c1",
          caller_phone: "+1",
          twilio_call_sid: "CA1",
          direction: "inbound",
          language: "en",
          case_type: "workers_comp",
          started_at: "2026-04-29T13:00:00Z",
          ended_at: "2026-04-29T13:17:00Z",
          duration: 1020,
        }),
        {} as never,
      );
      expect(r.outcome).toBe("success");
      expect(r.crm_record_id).toBe("i1");
      expect(Person.upsertByPhone).toHaveBeenCalled();
      expect(Intake.createIntake).toHaveBeenCalled();
      expect(Activity.completeCall).toHaveBeenCalled();
    });

    it("call.completed routes the same as call.ended", async () => {
      const { LitifyAdapter } = await import("./adapter");
      const a = new LitifyAdapter();
      const r = await a.handle(
        ev("call.completed", {
          call_id: "c1",
          caller_phone: "+1",
          twilio_call_sid: "CA1",
          language: "en",
          case_type: "workers_comp",
          started_at: "2026-04-29T13:00:00Z",
          ended_at: "2026-04-29T13:17:00Z",
          duration: 1020,
        }),
        {} as never,
      );
      expect(r.outcome).toBe("success");
    });

    it("call.extracted upserts intake with mapped fields", async () => {
      const { LitifyAdapter } = await import("./adapter");
      const Intake = await import("./intake");
      const a = new LitifyAdapter();
      const r = await a.handle(
        ev("call.extracted", {
          call_id: "c1",
          extracted_vars: { name: "John" },
          summary: "summary text",
        }),
        {} as never,
      );
      expect(r.outcome).toBe("success");
      expect(Intake.upsertByCallId).toHaveBeenCalled();
    });

    it("recording.ogg attaches recording to intake", async () => {
      const { LitifyAdapter } = await import("./adapter");
      const recording = await import("./recording");
      const a = new LitifyAdapter();
      const r = await a.handle(
        ev("recording.ogg", {
          call_id: "c1",
          download_url: "https://example.com/r.ogg",
        }),
        {} as never,
      );
      expect(r.outcome).toBe("success");
      expect(r.crm_record_id).toBe("cv1");
      expect(recording.attachRecordingToIntake).toHaveBeenCalled();
    });

    it("recording.ogg returns noop when no intake exists", async () => {
      const { LitifyAdapter } = await import("./adapter");
      const Intake = await import("./intake");
      vi.mocked(Intake.findByCallId).mockResolvedValueOnce(null);
      const a = new LitifyAdapter();
      const r = await a.handle(
        ev("recording.ogg", {
          call_id: "c1",
          download_url: "https://example.com/r.ogg",
        }),
        {} as never,
      );
      expect(r.outcome).toBe("noop");
    });

    it("evaluation.complete appends note and updates score", async () => {
      const { LitifyAdapter } = await import("./adapter");
      const Activity = await import("./activity");
      const Intake = await import("./intake");
      const a = new LitifyAdapter();
      const r = await a.handle(
        ev("evaluation.complete", {
          call_id: "c1",
          evaluation: { score: 0.9, summary: "qualified case" },
          qualified: true,
        }),
        {} as never,
      );
      expect(r.outcome).toBe("success");
      expect(Intake.upsertByCallId).toHaveBeenCalled();
      expect(Activity.appendNote).toHaveBeenCalled();
    });

    it("lead.qualified upserts intake with qualified status", async () => {
      const { LitifyAdapter } = await import("./adapter");
      const Intake = await import("./intake");
      const a = new LitifyAdapter();
      const r = await a.handle(
        ev("lead.qualified", {
          call_id: "c1",
          evaluation: { score: 0.95 },
        }),
        {} as never,
      );
      expect(r.outcome).toBe("success");
      expect(Intake.upsertByCallId).toHaveBeenCalled();
    });

    it("lead.needs_review upserts intake with review status", async () => {
      const { LitifyAdapter } = await import("./adapter");
      const Intake = await import("./intake");
      const a = new LitifyAdapter();
      const r = await a.handle(
        ev("lead.needs_review", {
          call_id: "c1",
          review_reason: "ambiguous case type",
          summary: "caller mentioned multiple injuries",
        }),
        {} as never,
      );
      expect(r.outcome).toBe("success");
      expect(Intake.upsertByCallId).toHaveBeenCalled();
    });

    it("unknown event type returns noop", async () => {
      const { LitifyAdapter } = await import("./adapter");
      const a = new LitifyAdapter();
      const r = await a.handle(ev("call.outbound_request"), {} as never);
      expect(r.outcome).toBe("noop");
    });

    it("returns retry on retryable exception", async () => {
      const { LitifyAdapter } = await import("./adapter");
      const Person = await import("./person");
      vi.mocked(Person.upsertByPhone).mockRejectedValueOnce(
        new Error("Network down"),
      );
      const a = new LitifyAdapter();
      const r = await a.handle(
        ev("call.ended", {
          call_id: "c1",
          caller_phone: "+1",
          twilio_call_sid: "CA1",
          language: "en",
          case_type: "workers_comp",
          started_at: "2026-04-29T13:00:00Z",
          ended_at: "2026-04-29T13:17:00Z",
          duration: 1020,
        }),
        {} as never,
      );
      expect(r.outcome).toBe("retry");
      expect(r.error?.message).toBe("Network down");
      expect(r.error?.retryable).toBe(true);
    });

    it("returns failure on non-retryable exception (DUPLICATE_VALUE)", async () => {
      const { LitifyAdapter } = await import("./adapter");
      const Person = await import("./person");
      const err = Object.assign(new Error("dup"), { errorCode: "DUPLICATE_VALUE" });
      vi.mocked(Person.upsertByPhone).mockRejectedValueOnce(err);
      const a = new LitifyAdapter();
      const r = await a.handle(
        ev("call.ended", {
          call_id: "c1",
          caller_phone: "+1",
          twilio_call_sid: "CA1",
          language: "en",
          case_type: "workers_comp",
          started_at: "2026-04-29T13:00:00Z",
          ended_at: "2026-04-29T13:17:00Z",
          duration: 1020,
        }),
        {} as never,
      );
      expect(r.outcome).toBe("failure");
      expect(r.error?.retryable).toBe(false);
    });
  });
});
