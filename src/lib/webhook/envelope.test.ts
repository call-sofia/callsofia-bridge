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

  it("throws on wrong schema_version", () => {
    expect(() => parseEnvelope({ ...VALID, schema_version: 99 })).toThrow();
  });

  it("rejects unknown event_type", () => {
    expect(() => parseEnvelope({ ...VALID, event_type: "totally.fake" })).toThrow();
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
