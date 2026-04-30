import { z } from "zod";
import { EVENT_TYPES, type CallSofiaEvent, type WebhookScope } from "./types";

const ScopeSchema = z.object({
  org_id: z.string().uuid(),
  workspace_id: z.string().uuid(),
  pipeline_id: z.string().uuid(),
  stage_id: z.string().uuid().nullable(),
});

/** Envelope shape per the original DESIGN.md spec — `data: { scope, payload }`. */
const NestedDataSchema = z.object({
  scope: ScopeSchema,
  payload: z.record(z.unknown()),
});

/** Actual platform-api shape (apps/platform-api/src/services/webhook_delivery.py:913) —
 *  `data` is a flat dict of trimmed call fields. There is no `scope`/`payload` wrapper. */
const FlatDataSchema = z.record(z.unknown()).refine(
  (d) => !("scope" in d && "payload" in d),
  { message: "Looks like nested data shape" },
);

export const EnvelopeSchema = z.object({
  event_id: z.string().uuid(),
  event_type: z.enum(EVENT_TYPES),
  emitted_at: z.string(),
  // Platform-api currently sends `schema_version: 1` for most events but the
  // original spec called for 2. Accept any small int to keep the receiver
  // tolerant; we record the value verbatim in events.schema_version.
  schema_version: z.number().int().min(1).max(99),
  data: z.union([NestedDataSchema, FlatDataSchema]),
});

const EMPTY_SCOPE: WebhookScope = {
  org_id: "00000000-0000-0000-0000-000000000000",
  workspace_id: "00000000-0000-0000-0000-000000000000",
  pipeline_id: "00000000-0000-0000-0000-000000000000",
  stage_id: null,
};

/**
 * Normalize the envelope so consumers always see `data.scope` and `data.payload`.
 * For flat platform-api shape, the entire `data` becomes `payload` and `scope`
 * defaults to a known-empty UUID block (the platform-api dispatcher knows the
 * real scope but doesn't relay it; we keep the field for downstream filters).
 */
export function parseEnvelope(input: unknown): CallSofiaEvent {
  const parsed = EnvelopeSchema.parse(input);
  const data = parsed.data as Record<string, unknown>;
  const isNested = "scope" in data && "payload" in data;
  const normalized: CallSofiaEvent["data"] = isNested
    ? (data as unknown as CallSofiaEvent["data"])
    : { scope: EMPTY_SCOPE, payload: data };
  return {
    ...parsed,
    schema_version: 2,
    data: normalized,
  } as CallSofiaEvent;
}
