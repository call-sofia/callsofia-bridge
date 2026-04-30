import type { CallSofiaEvent } from "@/lib/webhook/types";

export type TransformName = "raw" | "flat" | "litify-shape";

export function transformEvent(event: CallSofiaEvent, name: TransformName): unknown {
  if (name === "raw") return event;
  if (name === "flat") return flatten(event);
  if (name === "litify-shape") return litifyShape(event);
  throw new Error(`Unknown transform: ${name as string}`);
}

function flatten(event: CallSofiaEvent): Record<string, unknown> {
  const p = event.data.payload as Record<string, unknown>;
  const lead = (p.lead ?? {}) as Record<string, unknown>;
  return {
    event_id: event.event_id,
    event_type: event.event_type,
    emitted_at: event.emitted_at,
    org_id: event.data.scope.org_id,
    workspace_id: event.data.scope.workspace_id,
    pipeline_id: event.data.scope.pipeline_id,
    call_id: p.call_id,
    caller_phone: p.caller_phone_number ?? p.caller_phone,
    case_type: p.case_type,
    summary: p.summary,
    lead_name: lead.name,
    lead_email: lead.email,
    lead_stage: lead.stage,
    extracted: p.extracted_vars,
  };
}

function litifyShape(event: CallSofiaEvent): Record<string, unknown> {
  const p = event.data.payload as Record<string, unknown>;
  const ev = (p.extracted_vars ?? {}) as Record<string, unknown>;
  return {
    CallSofia_Event_ID__c: event.event_id,
    CallSofia_Event_Type__c: event.event_type,
    CallSofia_Call_ID__c: p.call_id,
    CallSofia_Phone__c: p.caller_phone_number ?? p.caller_phone,
    CallSofia_Case_Type__c: p.case_type,
    CallSofia_Summary__c: p.summary,
    CallSofia_Incident_Date__c: ev.incident_date,
    CallSofia_Injury_Type__c: ev.injury_type,
    CallSofia_Employer_Name__c: ev.employer_name,
  };
}
