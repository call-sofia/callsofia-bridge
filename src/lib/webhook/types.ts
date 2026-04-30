export const EVENT_TYPES = [
  "call.ringing", "call.answered", "call.in_progress",
  "call.completed", "call.disconnected", "call.ended",
  "call.requesting_transfer", "call.transferred", "call.transfer_failed",
  "call.extracted", "call.processed", "call.extracted.forwarded",
  "lead.qualified", "lead.needs_review",
  "evaluation.complete", "evaluation.failed",
  "recording.ogg", "call.outbound_request",
] as const;

export type EventType = typeof EVENT_TYPES[number];

export interface WebhookScope {
  org_id: string;
  workspace_id: string;
  pipeline_id: string;
  stage_id: string | null;
}

export interface CallSofiaEvent {
  event_id: string;
  event_type: EventType;
  emitted_at: string;
  schema_version: 2;
  data: {
    scope: WebhookScope;
    payload: Record<string, unknown>;
  };
}
