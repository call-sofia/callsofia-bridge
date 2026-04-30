# Payload Specification

What CallSofia sends, what the bridge accepts, what the bridge replies. If you're writing a sender, replaying captured traffic, or debugging a 400 response, this is the reference.

## Table of Contents

- [Transport](#transport)
- [Headers](#headers)
- [Envelope](#envelope)
- [Two accepted shapes](#two-accepted-shapes)
- [Real captured example](#real-captured-example)
- [Event types](#event-types)
- [`extracted_vars` field reference](#extracted_vars-field-reference)
- [Response contract](#response-contract)
- [Outbound (bridge → CRM)](#outbound-bridge--crm)

## Transport

- HTTPS POST to `/api/webhooks/callsofia`
- `Content-Type: application/json`
- UTF-8 body
- The receiver runs on Vercel Functions (`runtime: "nodejs"`, `dynamic: "force-dynamic"`) — no edge caching, no body transformation

The receiver reads the raw bytes of the body before parsing JSON, because the HMAC is computed over raw bytes. Any reverse proxy that re-serialises JSON between CallSofia and the bridge will break signature verification.

## Headers

| Header | Required | Example | Notes |
|---|---|---|---|
| `Content-Type` | yes | `application/json` | |
| `X-CallSofia-Event` | optional | `call.extracted` | Informational only — not consumed by the receiver; included for upstream tracing/debug. Mirrors `event_type` in the body. |
| `X-CallSofia-Delivery` | optional | `b12206f0-238c-44d7-991a-faa378b20a9b` | Informational only — not consumed by the receiver; included for upstream tracing/debug. Per-attempt delivery ID, different across retries of the same event. |
| `X-CallSofia-Timestamp` | yes | `1714501234` | UNIX seconds (string). The bridge also accepts UNIX milliseconds and ISO 8601 timestamps for compatibility — see [`src/lib/webhook/verify.ts`](../src/lib/webhook/verify.ts). |
| `X-CallSofia-Signature` | yes | `sha256=2f9a…` | HMAC-SHA256 hex digest of `"{timestamp}.{rawBody}"` using `CALLSOFIA_WEBHOOK_SECRET`. |

Header names are case-insensitive (Node normalises them lowercase). The verifier rejects signatures that don't start with `sha256=`.

## Envelope

```ts
{
  event_id: string,           // UUID v4 — primary idempotency key
  event_type: string,         // see "Event types" below
  emitted_at: string,         // ISO 8601 timestamp
  schema_version: number,     // 1 or 2 — recorded verbatim
  data: { /* see "Two accepted shapes" */ }
}
```

Validation lives in [`src/lib/webhook/envelope.ts`](../src/lib/webhook/envelope.ts) (Zod schema). Anything outside the schema returns 400 `{"error":"Invalid envelope"}`.

## Two accepted shapes

The original DESIGN spec called for `data: {scope, payload}`. The actual platform-api dispatcher (`apps/platform-api/src/services/webhook_delivery.py:913`) sends a flat shape — `data` is just the trimmed call fields. The bridge accepts both and normalises to the nested form before persisting.

**Nested (DESIGN spec):**

```json
{
  "event_id": "…",
  "event_type": "call.extracted",
  "emitted_at": "2026-04-30T18:34:49Z",
  "schema_version": 2,
  "data": {
    "scope": {
      "org_id": "…",
      "workspace_id": "…",
      "pipeline_id": "…",
      "stage_id": null
    },
    "payload": { "call_id": "…", "extracted_vars": { /* … */ } }
  }
}
```

**Flat (actual platform-api shape):**

```json
{
  "event_id": "…",
  "event_type": "call.extracted",
  "emitted_at": "2026-04-30T18:34:49Z",
  "schema_version": 1,
  "data": { "call_id": "…", "extracted_vars": { /* … */ } }
}
```

When the flat shape arrives, the receiver substitutes a default scope (all-zero UUIDs) and moves the entire `data` block into `payload`. Downstream, every adapter sees `event.data.scope` and `event.data.payload`.

## Real captured example

A live `call.extracted` payload as captured from production:

```json
{
  "event_id": "b12206f0-238c-44d7-991a-faa378b20a9b",
  "event_type": "call.extracted",
  "emitted_at": "2026-04-30T18:34:49.566956+00:00",
  "schema_version": 1,
  "data": {
    "person": {"phone": "+12132779473"},
    "call_id": "c2071f44-d0f6-4cb2-9759-b7cb3170ccfd",
    "case_type": "workers_comp",
    "extracted_vars": {}
  }
}
```

This is the flat shape, `schema_version: 1`. After normalisation it becomes:

```json
{
  "event_id": "b12206f0-238c-44d7-991a-faa378b20a9b",
  "event_type": "call.extracted",
  "emitted_at": "2026-04-30T18:34:49.566956+00:00",
  "schema_version": 2,
  "data": {
    "scope": {
      "org_id": "00000000-0000-0000-0000-000000000000",
      "workspace_id": "00000000-0000-0000-0000-000000000000",
      "pipeline_id": "00000000-0000-0000-0000-000000000000",
      "stage_id": null
    },
    "payload": {
      "person": {"phone": "+12132779473"},
      "call_id": "c2071f44-d0f6-4cb2-9759-b7cb3170ccfd",
      "case_type": "workers_comp",
      "extracted_vars": {}
    }
  }
}
```

## Event types

The complete list lives in [`src/lib/webhook/types.ts`](../src/lib/webhook/types.ts) (`EVENT_TYPES`). Anything outside this list is rejected with 400.

> **Caveat:** the `payload` field set below is illustrative — sender-defined and dependent on the platform-api version. The bridge stores `payload` verbatim but does **not** validate which fields are present. Adapters must feature-detect each field rather than assume the table is exhaustive or current.

| `event_type` | When it fires | Key fields in `payload` |
|---|---|---|
| `call.ringing` | Inbound SIP rings before answer | `call_id`, `caller_phone_number`, `to_phone_number` |
| `call.answered` | Voice agent picks up | `call_id`, `agent_id`, `language` |
| `call.in_progress` | Periodic in-call status (heartbeat) | `call_id`, `duration_seconds` |
| `call.completed` | Call ends with normal hangup | `call_id`, `duration_seconds`, `hangup_cause` |
| `call.disconnected` | Call drops abnormally | `call_id`, `disconnect_reason` |
| `call.ended` | Terminal event after hangup + cleanup. Most adapters key off this. | `call_id`, `duration_seconds`, `recording_url` (presigned), `transcript_url` |
| `call.requesting_transfer` | Agent requests human takeover | `call_id`, `transfer_target` |
| `call.transferred` | Hot-transfer succeeded | `call_id`, `attorney_id`, `transferred_at` |
| `call.transfer_failed` | Hot-transfer failed | `call_id`, `failure_reason` |
| `call.extracted` | Post-call structured-data extraction completes | `call_id`, `case_type`, `extracted_vars`, `person`, `summary` |
| `call.processed` | Full post-call pipeline (extraction → evaluation → memory) finished | `call_id`, `lead_id` (if created) |
| `call.extracted.forwarded` | Bridge-internal — emitted by some senders to mark a forwarded extraction | `call_id`, `target` |
| `lead.qualified` | AI evaluator scored the lead as qualified | `lead_id`, `call_id`, `ai_qualified: true`, `ai_overall_score` |
| `lead.needs_review` | Lead requires human triage | `lead_id`, `call_id`, `reason` |
| `evaluation.complete` | Evaluation pipeline finished | `call_id`, `lead_id`, `result` |
| `evaluation.failed` | Evaluation pipeline errored | `call_id`, `error` |
| `recording.ogg` | Recording was uploaded to S3 and is ready | `call_id`, `recording_url` (presigned), `duration_seconds`, `size_bytes` |
| `call.outbound_request` | An outbound call was requested | `target_phone`, `agent_id`, `metadata` |

Per-event-type opt-in toggles are documented in [`configuration.md`](./configuration.md#event-handler-toggles).

## `extracted_vars` field reference

Carried on `call.extracted` (and surfaced again on `lead.qualified` / `evaluation.complete`). The shape is **dynamic** — what's present depends on the questions the voice agent successfully answered during the call. All fields are optional. The bridge persists whatever arrives verbatim into `events.payload`.

The canonical field set (typical PI/workers-comp intake):

| Field | Example | Notes |
|---|---|---|
| `pnc_full_name` | `"Jane Doe"` | Potential New Client name |
| `pnc_primary_phone` | `"+12132779473"` | E.164 |
| `pnc_email` | `"jane@example.com"` | |
| `pnc_full_address` | `"123 Main St, Los Angeles, CA 90001"` | |
| `pnc_date_of_birth` | `"1985-06-12"` | ISO date |
| `incident_date` | `"2026-04-15"` | |
| `incident_time` | `"14:30"` | 24h |
| `incident_state` | `"CA"` | USPS code |
| `incident_city` | `"Los Angeles"` | |
| `incident_detailed_narrative` | `"Rear-ended at a red light…"` | Free-form |
| `place_of_incident` | `"intersection"` | Categorised |
| `injuries_claimed` | `["whiplash","lower back pain"]` | |
| `body_parts_affected` | `["neck","lower back"]` | |
| `medical_diagnosis` | `"cervical strain"` | |
| `currently_under_treatment` | `true` | |
| `went_to_er_or_urgent_care` | `true` | |
| `photos_videos_available` | `true` | |
| `police_report_number` | `"LAPD-2026-001234"` | |
| `adverse_party_name_or_company` | `"John Smith"` | |
| `adverse_insurance_company` | `"State Farm"` | |
| `insurance_claim_filed` | `false` | |
| `employer_name` | `"Acme Corp"` | Workers' comp |
| `ai_case_type` | `"motor_vehicle"` | One of the org's `pipeline_case_types` |
| `ai_qualified` | `true` | Boolean qualifier |
| `ai_overall_score` | `0.87` | 0–1 |
| `ai_call_status` | `"qualified"` | `qualified` \| `needs_review` \| `unqualified` \| `spam` |
| `ai_call_status_reasoning` | `"Statute of limitations OK; injuries documented; treatment ongoing."` | LLM rationale |
| `summary` | `"Caller is a 41-year-old…"` | Brief |
| `damages_analysis` | `"Property damage est $4500…"` | |
| `liability_analysis` | `"Adverse party at fault per police report."` | |
| `witnesses_present` | `false` | |
| `missed_work_due_to_injuries` | `true` | |
| `property_damage_description` | `"Rear bumper crushed; trunk inoperable."` | |

Field names are stable but the set evolves as new questions are added to intake scripts. Adapters should treat `extracted_vars` as `Record<string, unknown>` and feature-detect each field.

## Response contract

| Status | Body | When |
|---|---|---|
| 200 | `{"ok":true}` | Happy path. Event persisted, mirror dispatched, queue published. |
| 200 | `{"ok":true,"duplicate":true}` | `event_id` already in the `events` table — idempotent replay. |
| 400 | `{"error":"Invalid envelope"}` | Body failed Zod validation. |
| 400 | `{"error":"Timestamp too old"}` | `X-CallSofia-Timestamp` is more than 300s away from server clock. |
| 401 | `{"error":"Invalid signature"}` | HMAC mismatch. Event is **not** persisted. |
| 500 | (varies) | Postgres unreachable or config invalid. Sender should retry. |

The 500 case relies on the sender's retry policy; CallSofia retries up to 10 times with exponential backoff.

## Outbound (bridge → CRM)

Outbound shapes are adapter-specific:

- **Litify** — Salesforce REST `sObject` upserts against custom CallSofia fields. See [`integrations/litify.md`](./integrations/litify.md).
- **Generic webhook** — Configurable transform (`raw` \| `flat` \| `litify-shape`); optionally HMAC-signed using the same scheme the bridge accepts inbound. See [`integrations/generic-webhook.md`](./integrations/generic-webhook.md).
- **None** — No outbound traffic. Events still land in `events`.

For the request flow end-to-end see [`architecture.md`](./architecture.md#pipeline-at-a-glance).
