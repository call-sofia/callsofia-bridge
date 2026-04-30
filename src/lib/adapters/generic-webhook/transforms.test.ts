import { describe, it, expect } from "vitest";
import { transformEvent } from "./transforms";
import type { CallSofiaEvent } from "@/lib/webhook/types";

const event: CallSofiaEvent = {
  event_id: "abc",
  event_type: "lead.qualified",
  emitted_at: "2026-04-29T13:00:00+00:00",
  schema_version: 2,
  data: {
    scope: { org_id: "o", workspace_id: "w", pipeline_id: "p", stage_id: null },
    payload: { call_id: "c", caller_phone_number: "+1", lead: { name: "Janelle" }, extracted_vars: { injury_type: "back" } },
  },
};

describe("transformEvent", () => {
  it("raw passes envelope through", () => {
    const r = transformEvent(event, "raw") as CallSofiaEvent;
    expect(r.event_id).toBe("abc");
    expect(r.data.payload).toEqual(event.data.payload);
  });

  it("flat hoists payload + scope", () => {
    const r = transformEvent(event, "flat") as Record<string, unknown>;
    expect(r.event_type).toBe("lead.qualified");
    expect(r.org_id).toBe("o");
    expect(r.call_id).toBe("c");
    expect(r.lead_name).toBe("Janelle");
  });

  it("litify-shape produces SObject-style fields", () => {
    const r = transformEvent(event, "litify-shape") as Record<string, unknown>;
    expect(r.CallSofia_Call_ID__c).toBe("c");
    expect(r.CallSofia_Injury_Type__c).toBe("back");
  });

  it("throws on unknown transform name", () => {
    // @ts-expect-error - intentional bad value
    expect(() => transformEvent(event, "unknown")).toThrow();
  });
});
