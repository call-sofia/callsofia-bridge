import { describe, it, expect } from "vitest";
import { parseEnvelope } from "./envelope";

const VALID = {
  event_id: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  event_type: "call.ended",
  emitted_at: "2026-04-29T13:21:39.043523+00:00",
  schema_version: 2,
  data: {
    scope: {
      org_id: "10000000-0000-0000-0000-000000000001",
      workspace_id: "20000000-0000-0000-0000-000000000001",
      pipeline_id: "80000000-0000-0000-0000-000000000001",
      stage_id: null,
    },
    payload: { call_id: "abc", duration: 100 },
  },
};

describe("envelope", () => {
  it("parses valid envelope", () => {
    const result = parseEnvelope(VALID);
    expect(result.event_type).toBe("call.ended");
  });

  it("throws on missing event_id", () => {
    const bad = { ...VALID, event_id: undefined };
    expect(() => parseEnvelope(bad)).toThrow();
  });

  it("rejects out-of-range schema_version", () => {
    expect(() => parseEnvelope({ ...VALID, schema_version: 100 })).toThrow();
    expect(() => parseEnvelope({ ...VALID, schema_version: 0 })).toThrow();
  });

  it("accepts schema_version 1 (platform-api default)", () => {
    const result = parseEnvelope({ ...VALID, schema_version: 1 });
    // We always normalise to 2 for downstream consumers.
    expect(result.schema_version).toBe(2);
  });

  it("rejects unknown event_type", () => {
    expect(() => parseEnvelope({ ...VALID, event_type: "totally.fake" })).toThrow();
  });

  it("accepts flat-data envelope (actual platform-api shape)", () => {
    const flat = {
      event_id: "b12206f0-238c-44d7-991a-faa378b20a9b",
      event_type: "call.extracted",
      emitted_at: "2026-04-30T18:34:49.566956+00:00",
      schema_version: 1,
      data: {
        person: { phone: "+12132779473" },
        call_id: "c2071f44-d0f6-4cb2-9759-b7cb3170ccfd",
        case_type: "workers_comp",
        extracted_vars: {},
      },
    };
    const result = parseEnvelope(flat);
    expect(result.event_type).toBe("call.extracted");
    // Flat data is wrapped: scope is the empty default, payload is the original data.
    expect(result.data.payload).toMatchObject({ call_id: "c2071f44-d0f6-4cb2-9759-b7cb3170ccfd" });
    expect(result.data.scope.org_id).toBe("00000000-0000-0000-0000-000000000000");
  });

  it("accepts all 18 known event types", () => {
    const types = [
      "call.ringing", "call.answered", "call.in_progress",
      "call.completed", "call.disconnected", "call.ended",
      "call.requesting_transfer", "call.transferred", "call.transfer_failed",
      "call.extracted", "call.processed", "call.extracted.forwarded",
      "lead.qualified", "lead.needs_review",
      "evaluation.complete", "evaluation.failed",
      "recording.ogg", "call.outbound_request",
    ];
    for (const t of types) {
      const result = parseEnvelope({ ...VALID, event_type: t });
      expect(result.event_type).toBe(t);
    }
  });
});
