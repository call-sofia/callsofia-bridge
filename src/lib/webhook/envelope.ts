import { z } from "zod";
import { EVENT_TYPES, type CallSofiaEvent } from "./types";

const ScopeSchema = z.object({
  org_id: z.string().uuid(),
  workspace_id: z.string().uuid(),
  pipeline_id: z.string().uuid(),
  stage_id: z.string().uuid().nullable(),
});

export const EnvelopeSchema = z.object({
  event_id: z.string().uuid(),
  event_type: z.enum(EVENT_TYPES),
  emitted_at: z.string(),
  schema_version: z.literal(2),
  data: z.object({
    scope: ScopeSchema,
    payload: z.record(z.unknown()),
  }),
});

export function parseEnvelope(input: unknown): CallSofiaEvent {
  return EnvelopeSchema.parse(input) as CallSofiaEvent;
}
