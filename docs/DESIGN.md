# CallSofia Bridge — Design Spec

> **Created:** 2026-04-29 | **Status:** Draft, awaiting approval
> **Repo (to create):** `github.com/call-sofia/callsofia-bridge`
> **Hosting:** Vercel (Fluid Compute, Node.js 24 LTS)
> **Primary CRM target:** Litify (Salesforce-based legal case management)

---

## 1. Executive Summary

**CallSofia Bridge** is a standalone webhook middleware service that sits between the CallSofia Platform API and a law firm client's CRM. It receives every webhook event CallSofia emits, persists it durably, runs configured handlers per event type, and pushes structured data into the client's CRM (Litify on day one, generic adapters next).

Each client gets their own Vercel deployment from a shared codebase, configured with that client's CallSofia api-key, Salesforce/Litify credentials, and behavior rules via env vars. The bridge mirrors every event back to CallSofia's `activity_logs` table so we can verify end-to-end delivery from our side.

**Why we're building this:**

1. CallSofia stays focused on AI voice intake — CRM integration is not our core competence
2. Per-client CRM customization (field mappings, custom logic, retry policies) belongs in client-owned infrastructure
3. Clients want their data flowing into systems they already pay for and already trust
4. We retain observability without owning brittle CRM integrations

---

## 2. Goals & Non-Goals

### Goals

- **Zero data loss** — every CallSofia webhook event must be persisted and processed (or explicitly marked as no-op)
- **At-least-once delivery to CRM** — with idempotency to avoid duplicate records
- **Per-client isolation** — bug or outage in one client's bridge never affects another's
- **CallSofia-side observability** — we can query our own `activity_logs` and see every event the bridge received and how it processed
- **Self-service deployment** — a new client deployment is "fork → set env vars → push to main" with no code changes required for standard cases
- **Litify integration is production-grade** — full intake-to-matter flow with proper field mapping
- **Pluggable adapter pattern** — new CRM = drop in one file

### Non-Goals (Phase 1)

- Multi-tenant single-deployment serving multiple clients (we picked Hybrid C — one deploy per client)
- A configuration UI for non-developer client staff (env vars only)
- Two-way sync (CRM → CallSofia) — this is one-way flow, CallSofia → CRM
- Real-time event streaming or websockets — webhooks are POST + 200, sufficient for this domain
- Customer-facing analytics dashboard (CallSofia keeps that)

---

## 3. High-Level Architecture

```
                                  ┌──────────────────────────────────┐
                                  │      CallSofia Platform API      │
                                  │  (api.callsofia.co — ECS)        │
                                  │                                  │
                                  │  webhook_delivery.py             │
                                  │  HMAC-SHA256 signed POSTs        │
                                  └──────────────┬───────────────────┘
                                                 │
                                                 │ POST + signature
                                                 ▼
   ┌─────────────────────────────────────────────────────────────────────────┐
   │  CallSofia Bridge (Vercel — bridge.<client>.callsofia.co)               │
   │                                                                         │
   │  ┌────────────────────────┐   ┌─────────────────────────────────┐       │
   │  │ POST /api/webhooks     │   │  Postgres (Neon)                │       │
   │  │ ─────────────────────  │   │ ─────────────────────────────── │       │
   │  │ 1. Verify HMAC         │   │  events (ledger)                │       │
   │  │ 2. Persist raw event   │──▶│  deliveries (per-handler state) │       │
   │  │ 3. Mirror to platform  │   │  retry_queue                    │       │
   │  │ 4. Enqueue work        │   │  config_overrides               │       │
   │  │ 5. Return 200 < 500ms  │   └─────────────────────────────────┘       │
   │  └──────────┬─────────────┘                                             │
   │             │                                                           │
   │             ▼                                                           │
   │  ┌────────────────────────┐                                             │
   │  │ Vercel Queue           │   ┌─────────────────────────────────┐       │
   │  │ "events.process"       │   │  Upstash Redis (Marketplace)    │       │
   │  │ at-least-once delivery │   │ ─────────────────────────────── │       │
   │  └──────────┬─────────────┘   │  idempotency keys (24h TTL)     │       │
   │             │                 │  rate limit buckets             │       │
   │             ▼                 └─────────────────────────────────┘       │
   │  ┌────────────────────────┐                                             │
   │  │ Queue Consumer         │                                             │
   │  │ /api/queue/consumer    │                                             │
   │  │ ─────────────────────  │                                             │
   │  │ - Idempotency check    │                                             │
   │  │ - Look up handler      │                                             │
   │  │ - Default: pass-thru   │                                             │
   │  │ - Run CRM Adapter      │                                             │
   │  │ - Persist outcome      │                                             │
   │  │ - Mirror to platform   │                                             │
   │  │ - Retry on failure     │                                             │
   │  └──────────┬─────────────┘                                             │
   │             │                                                           │
   │  ┌──────────▼─────────────────────────────────────────────────┐         │
   │  │              CRM Adapter Interface                         │         │
   │  │  ┌──────────────┐  ┌─────────────┐  ┌──────────────────┐   │         │
   │  │  │ LitifyAdapter│  │ HubSpot...  │  │ GenericWebhook   │   │         │
   │  │  └──────────────┘  └─────────────┘  └──────────────────┘   │         │
   │  └──────────┬─────────────────────────────────────────────────┘         │
   │             │                                                           │
   │  ┌──────────▼─────────────┐    ┌─────────────────────────────┐          │
   │  │ /admin (Next.js)       │    │ Platform API Client         │          │
   │  │ Recent events          │    │ - POST /v1/activity-logs    │          │
   │  │ Failure dashboard      │    │ - GET  /v1/leads/...        │          │
   │  │ Replay UI              │    │ - GET  /v1/calls/...        │          │
   │  │ HMAC-protected         │    │ X-API-Key: sk_<env>_<...>   │          │
   │  └────────────────────────┘    └─────────────┬───────────────┘          │
   │                                              │                          │
   └──────────────────────────────────────────────┼──────────────────────────┘
                                                  │
                                                  ▼
                                  ┌─────────────────────────────┐
                                  │   Client CRM (Litify on SF) │
                                  │   Salesforce REST API       │
                                  │   OAuth 2.0 client creds    │
                                  └─────────────────────────────┘
```

---

## 4. Components

### 4.1 Webhook Receiver (`/api/webhooks/callsofia`)

Single entry point for all CallSofia webhooks. Runs as a Vercel Function (Fluid Compute, Node.js 24).

**Responsibilities:**
1. Verify `X-CallSofia-Signature` HMAC-SHA256 against `CALLSOFIA_WEBHOOK_SECRET`
2. Validate timestamp freshness (reject if > 5 min old — replay attack prevention)
3. Parse envelope, extract `event_id`, `event_type`, `data.scope`, `data.payload`
4. **Idempotency check** — if `event_id` already exists in `events` table or Redis cache, return 200 immediately without enqueueing (CallSofia retries)
5. Persist raw event to `events` table with status `received`
6. **Fire-and-forget** mirror to platform-api `/v1/activity-logs` (non-blocking; failure logged but doesn't fail the webhook)
7. Enqueue to Vercel Queue `events.process` with `event_id` as the message
8. Return 200 in < 500ms

**Failure modes:**
- Invalid signature → 401, do not persist, do not retry
- Postgres unavailable → 500, CallSofia retries (we have 10 attempts on the sender side)
- Queue enqueue fails → fall back to writing to `retry_queue` table, processed by cron

### 4.2 Queue Consumer (`/api/queue/consumer`)

Triggered by Vercel Queue messages. Processes one event at a time.

**Responsibilities:**
1. Load event from `events` table by `event_id`
2. **Second idempotency check** — if `deliveries` row exists with status `succeeded` for this `(event_id, handler_id)`, skip
3. Look up handler config for `event_type` (env-var driven, see §7)
4. **Default behavior** — if no handler configured for this event type, mark `deliveries` as `noop`, return success
5. Construct `EventContext` with all data the handler needs
6. Invoke matching `CrmAdapter` method
7. Persist outcome: `succeeded`, `failed`, `retrying`
8. Mirror outcome to platform-api `/v1/activity-logs`
9. On failure: increment retry_count; if < MAX_RETRIES, re-enqueue with delay; else dead-letter

**Concurrency:** Vercel Functions reuse instances under Fluid Compute, but each message processes serially within an instance. Postgres `SELECT ... FOR UPDATE SKIP LOCKED` prevents two consumers grabbing the same event.

### 4.3 CRM Adapter Interface

```typescript
// src/lib/adapters/types.ts

export interface CrmAdapter {
  /** Adapter name for logging and config */
  readonly name: string;

  /** Initialize / verify credentials. Throws on auth failure. */
  init(): Promise<void>;

  /** Map CallSofia event to CRM operation. Returns operation outcome. */
  handle(event: CallSofiaEvent, ctx: AdapterContext): Promise<HandlerResult>;

  /** Health check — verify CRM is reachable and creds are valid */
  healthCheck(): Promise<HealthStatus>;
}

export interface AdapterContext {
  /** Platform API client for fetching extra data if needed */
  platformApi: PlatformApiClient;
  /** Logger that writes to local Postgres + mirrors to platform-api */
  logger: BridgeLogger;
  /** Config for this adapter (from env vars) */
  config: AdapterConfig;
}

export interface HandlerResult {
  outcome: "success" | "noop" | "failure" | "retry";
  crm_record_id?: string;       // e.g. Salesforce/Litify ID
  crm_record_url?: string;      // deep link to CRM record
  message?: string;             // human-readable
  error?: { code: string; message: string; retryable: boolean };
  /** Number of CRM API calls made (for cost tracking) */
  api_calls?: number;
}
```

### 4.4 Litify Adapter (Primary Reference Implementation)

**Litify** is a Salesforce managed package for legal case management. Custom objects:

| Object | Purpose | API Name |
|---|---|---|
| Intake | First-touch record from a phone call/form | `litify_pm__Intake__c` |
| Matter | The actual legal case | `litify_pm__Matter__c` |
| Person | Party/individual | `litify_pm__Person__c` |
| Case Type | Practice area lookup | `litify_pm__Case_Type__c` |
| Activity | Logged interaction (call, email) | `Task` (standard SF) |

**Litify-specific event mapping:**

| CallSofia Event | Litify Operation |
|---|---|
| `call.ringing` | Search `litify_pm__Person__c` by phone; if found, create `Task` (Activity) with type "Call - Inbound", status "In Progress" |
| `call.answered` | Update existing Task status, log timestamp |
| `call.in_progress` | Update Task `Description` with first utterance preview |
| `call.ended` | (a) Find or create `litify_pm__Person__c` by `caller_phone`, (b) Create `litify_pm__Intake__c` with intake date, source, person link, (c) Update Task with duration, mark Completed |
| `call.extracted` | Upsert `litify_pm__Intake__c` fields from `extracted_vars` (incident date, injury type, employer, etc.) — full mapping in §6 |
| `lead.qualified` | Set Intake `litify_pm__Status__c = 'Qualified'`, optionally trigger Litify's intake-to-matter flow if `LITIFY_AUTO_CONVERT_QUALIFIED=true` |
| `lead.needs_review` | Set Intake `litify_pm__Status__c = 'Needs Review'`, assign to `INTAKE_COORDINATOR_USER_ID` |
| `evaluation.complete` | Update Intake custom field `CallSofia_Quality_Score__c` |
| `recording.ogg` | Download from presigned URL, upload as `ContentDocument` linked to Intake |
| `call.transferred` | Append note to Task: "Transferred to <attorney>" |
| `call.transfer_failed` | Append note + flag Intake for follow-up |

**Auth:** OAuth 2.0 Client Credentials Flow via Salesforce Connected App. Token cached in Redis with `expires_at` minus 5min safety margin.

**Failure-mode handling:**
- 401 / token expired → refresh, retry once
- 429 / rate limit → respect `Retry-After`, requeue with delay
- 5xx → retry with exponential backoff (3 attempts)
- 4xx (other) → dead-letter, do not retry
- Custom field doesn't exist → log error, don't retry, send Slack alert via webhook

**SOQL / DML idempotency:**
- All inserts use `External_ID__c = <CallSofia event_id>` field — Salesforce Upsert by external ID prevents duplicates
- Each Intake gets `CallSofia_Call_ID__c` populated to find existing records on subsequent events for the same call

### 4.5 Generic Webhook Forwarder Adapter

For clients on Filevine, MyCase, custom systems, or running their own logic via Zapier/Make:

```typescript
class GenericWebhookAdapter implements CrmAdapter {
  // Transforms event to a configurable shape and POSTs to a target URL
  // - GENERIC_WEBHOOK_URL — destination
  // - GENERIC_WEBHOOK_SECRET — HMAC signs outbound (optional)
  // - GENERIC_WEBHOOK_TRANSFORM — "raw" | "flat" | "litify-shape"
}
```

The "litify-shape" transform pre-maps fields so a Zapier workflow targeting Litify-via-Zap can use the same field structure as our native Litify adapter.

### 4.6 Platform API Client

Wraps calls back to CallSofia from the bridge. Uses `X-API-Key` auth.

```typescript
class PlatformApiClient {
  constructor(opts: { apiKey: string; orgId: string; baseUrl: string });

  // Mirror events for end-to-end visibility
  logActivity(entry: ActivityLogEntry): Promise<void>;
  logActivityBatch(entries: ActivityLogEntry[]): Promise<void>;

  // Fetch additional data if the bridge needs it
  getCallDetail(callId: string): Promise<CallDetail>;
  getCallTrace(callId: string): Promise<CallTrace>;
  getLead(leadId: string): Promise<Lead>;
  getRecording(callId: string): Promise<RecordingMeta>;
}
```

**Activity log entries the bridge writes:**

| Type | When | Severity |
|---|---|---|
| `bridge.event_received` | Every webhook arrival | INFO |
| `bridge.handler_started` | Adapter invocation begins | DEBUG |
| `bridge.handler_succeeded` | CRM operation OK | INFO |
| `bridge.handler_failed` | CRM operation failed | ERROR |
| `bridge.handler_noop` | No handler configured for event type | DEBUG |
| `bridge.retry_scheduled` | Will retry later | WARN |
| `bridge.dead_letter` | Exhausted retries | ERROR |
| `bridge.health_check` | Periodic self-test | INFO |

This means CallSofia can run analytics like "show me all events for org X in the last 24h that the bridge received but failed to process."

### 4.7 Postgres Schema

```sql
-- Every webhook ever received (the source of truth)
CREATE TABLE events (
  event_id          UUID PRIMARY KEY,                    -- from CallSofia envelope
  event_type        TEXT NOT NULL,
  emitted_at        TIMESTAMPTZ NOT NULL,
  received_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  schema_version    SMALLINT NOT NULL,
  scope             JSONB NOT NULL,                      -- {org_id, workspace_id, pipeline_id, stage_id}
  payload           JSONB NOT NULL,                      -- the data.payload object
  raw_envelope      JSONB NOT NULL,                      -- full original body
  signature_valid   BOOLEAN NOT NULL,
  status            TEXT NOT NULL DEFAULT 'received'     -- received | processing | done | failed
);
CREATE INDEX events_event_type_idx ON events (event_type);
CREATE INDEX events_received_at_idx ON events (received_at DESC);
CREATE INDEX events_status_idx ON events (status) WHERE status != 'done';

-- Per-handler delivery state
CREATE TABLE deliveries (
  id                BIGSERIAL PRIMARY KEY,
  event_id          UUID NOT NULL REFERENCES events(event_id) ON DELETE CASCADE,
  handler_id        TEXT NOT NULL,                       -- "litify" | "generic-webhook" | etc.
  attempt           INTEGER NOT NULL DEFAULT 1,
  status            TEXT NOT NULL,                       -- pending | succeeded | failed | retrying | noop | dead_letter
  outcome           JSONB,                               -- HandlerResult JSON
  crm_record_id     TEXT,                                -- e.g. Litify Intake ID
  error_code        TEXT,
  error_message     TEXT,
  started_at        TIMESTAMPTZ,
  completed_at      TIMESTAMPTZ,
  next_retry_at     TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (event_id, handler_id, attempt)
);
CREATE INDEX deliveries_event_id_idx ON deliveries (event_id);
CREATE INDEX deliveries_status_idx ON deliveries (status, next_retry_at) WHERE status IN ('retrying', 'pending');

-- Fallback retry queue if Vercel Queues is unavailable
CREATE TABLE retry_queue (
  id                BIGSERIAL PRIMARY KEY,
  event_id          UUID NOT NULL,
  handler_id        TEXT NOT NULL,
  scheduled_for     TIMESTAMPTZ NOT NULL,
  attempt           INTEGER NOT NULL DEFAULT 1,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX retry_queue_scheduled_idx ON retry_queue (scheduled_for);

-- Optional: per-event-type config overrides (advanced clients)
CREATE TABLE config_overrides (
  event_type        TEXT PRIMARY KEY,
  enabled           BOOLEAN NOT NULL DEFAULT TRUE,
  handler_id        TEXT NOT NULL,
  config            JSONB NOT NULL DEFAULT '{}'::JSONB,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 4.8 Admin Dashboard (`/admin`)

Next.js App Router pages, protected by Vercel Password Protection or a single-password env var (since one admin per deployment, not multi-user):

- **`/admin`** — Recent events table (last 100): event_type, status, latency, handler outcome, error
- **`/admin/events/[event_id]`** — Single event detail: full envelope, delivery history, raw CRM API request/response
- **`/admin/failures`** — Only failed events, with one-click "Retry now" button
- **`/admin/health`** — Status of: Postgres, Redis, Litify auth, platform-api, queue depth
- **`/admin/replay`** — Bulk replay UI (pick event types and date range, requeue them)

Built with shadcn/ui (matches your other apps).

---

## 5. Data Flow — End-to-End Example

A real call (using the Janelle Smith workers comp example from live testing):

```
T+0ms      CallSofia emits call.ringing
T+50ms     Bridge receives POST → verify HMAC → INSERT events row → enqueue → 200 returned
T+~        Mirror to platform-api activity_logs (fire-and-forget)
T+150ms    Queue consumer picks up event_id
T+155ms    Idempotency check (Redis): not seen → continue
T+200ms    Look up handler for "call.ringing" → "litify"
T+210ms    LitifyAdapter.handle()
              → SOQL: SELECT Id FROM litify_pm__Person__c WHERE Phone = '+12132779473'
              → No match → skip Person creation (we'll create on call.ended)
              → Create Task (Activity): subject="Inbound Call", status="In Progress"
T+450ms    Task created (SF returns ID)
T+460ms    UPDATE deliveries SET status='succeeded', crm_record_id='00T...' WHERE id=...
T+470ms    Mirror outcome to platform-api activity_logs
T+475ms    Queue ack

[~17 minutes later: call ends]

T+~17min   call.ended received → Bridge → Queue → LitifyAdapter
              → Find/create Person by phone
              → Create Intake record with caller_phone, started_at, ended_at, duration, language, case_type
              → Update Task: status="Completed", duration filled
              → Result: Intake ID = a0Xxx...

T+~18min   call.extracted received → LitifyAdapter
              → SOQL: find Intake by CallSofia_Call_ID__c = <call_id>
              → UPDATE litify_pm__Intake__c SET
                  CallSofia_Incident_Date__c = '2026-04-24',
                  CallSofia_Injury_Type__c = 'lower_back',
                  CallSofia_Employer_Name__c = 'Pacific Logistics Inc.',
                  CallSofia_Medical_Treatment__c = 'none',
                  Description = '<summary>'

T+~18min   lead.qualified received → LitifyAdapter
              → UPDATE Intake SET litify_pm__Status__c = 'Qualified', Rating__c = 'Hot'
              → Optionally: trigger litify_pm__Convert_to_Matter flow

T+~25min   evaluation.complete → UPDATE Intake CallSofia_Quality_Score__c = 87

T+~30min   recording.ogg → Download from presigned URL, upload as ContentDocument linked to Intake
```

---

## 6. Litify Field Mapping Reference

### 6.1 Required Custom Fields on `litify_pm__Intake__c`

The bridge expects these custom fields to exist on Litify Intake. Field creation script in `scripts/litify/create-custom-fields.sh` (uses `sf` CLI).

| API Name | Type | Purpose |
|---|---|---|
| `CallSofia_Call_ID__c` | Text(36), External ID, Unique | Idempotency key — links Intake to CallSofia call |
| `CallSofia_Event_ID__c` | Text(36), External ID, Unique | Last-applied event_id (for ordering) |
| `CallSofia_Quality_Score__c` | Number(3,0) | AI evaluation score 0-100 |
| `CallSofia_Language__c` | Picklist (en, es, hi) | Detected call language |
| `CallSofia_Case_Type__c` | Text(80) | Detected case type (workers_comp, etc.) |
| `CallSofia_Twilio_SID__c` | Text(50) | Twilio call SID for trace |
| `CallSofia_Recording_URL__c` | URL(255) | Presigned recording URL |
| `CallSofia_Summary__c` | Long Text Area(32768) | AI-generated summary |
| `CallSofia_Incident_Date__c` | Date | From extracted_vars |
| `CallSofia_Injury_Type__c` | Text(255) | From extracted_vars |
| `CallSofia_Employer_Name__c` | Text(255) | From extracted_vars |
| `CallSofia_Medical_Treatment__c` | Text(100) | From extracted_vars |
| `CallSofia_Prior_Attorney__c` | Checkbox | From extracted_vars |
| `CallSofia_Last_Synced_At__c` | DateTime | Last bridge update |

### 6.2 Standard Litify Fields We Populate

| Litify Field | CallSofia Source |
|---|---|
| `Name` | Auto-numbered by Litify |
| `litify_pm__Person__c` | Lookup populated after Person upsert |
| `litify_pm__Source__c` | Constant: "AI Voice Intake (CallSofia)" |
| `litify_pm__Status__c` | Mapped: `qualified`→Qualified, `needs_review`→Needs Review |
| `litify_pm__Case_Type_Lookup__c` | Mapped from `case_type` to Litify Case Type record |
| `litify_pm__Date_Opened__c` | From `started_at` |
| `Description` | From `summary` |
| `OwnerId` | From `INTAKE_DEFAULT_OWNER_ID` env var |

### 6.3 Case Type Mapping

```typescript
const CASE_TYPE_TO_LITIFY: Record<string, string> = {
  // CallSofia case_type → Litify Case Type record name
  workers_comp: "Workers' Compensation",
  auto_accident: "Auto Accident",
  slip_and_fall: "Premises Liability",
  premises_liability: "Premises Liability",
  medical_malpractice: "Medical Malpractice",
  product_liability: "Product Liability",
  wrongful_death: "Wrongful Death",
  general_injury: "General Personal Injury",
};
```

The bridge resolves the matching `litify_pm__Case_Type__c` record ID via SOQL on first use and caches in Redis (24h).

---

## 7. Configuration (Environment Variables)

All config via env vars. No config UI for secrets.

```bash
# ─── CallSofia Connection ─────────────────────────────────────
CALLSOFIA_API_BASE_URL=https://api.callsofia.co
CALLSOFIA_ORG_ID=10000000-0000-0000-0000-000000000001
CALLSOFIA_API_KEY=sk_prod_acmelaw_xxx                  # for outbound calls to platform-api
CALLSOFIA_WEBHOOK_SECRET=whsec_xxx                     # HMAC verification

# ─── Vercel Marketplace Storage ───────────────────────────────
DATABASE_URL=postgres://...                            # Neon Postgres
REDIS_URL=rediss://...                                 # Upstash Redis
QUEUE_TOKEN=...                                        # Vercel Queues access token

# ─── Active CRM Adapter ───────────────────────────────────────
CRM_ADAPTER=litify                                     # litify | hubspot | generic-webhook | none

# ─── Litify (Salesforce) Auth ─────────────────────────────────
SALESFORCE_LOGIN_URL=https://login.salesforce.com      # or test.salesforce.com for sandbox
SALESFORCE_CLIENT_ID=3MVG9...
SALESFORCE_CLIENT_SECRET=xxx
SALESFORCE_USERNAME=integration@acmelaw.com
SALESFORCE_PASSWORD=xxx
SALESFORCE_SECURITY_TOKEN=xxx

# ─── Litify Behavior ──────────────────────────────────────────
LITIFY_AUTO_CONVERT_QUALIFIED=false                    # auto-trigger Intake→Matter on qualified
INTAKE_DEFAULT_OWNER_ID=005xx0000012345                # Salesforce User ID
INTAKE_COORDINATOR_USER_ID=005xx0000067890             # for needs_review assignment
LITIFY_INTAKE_RECORD_TYPE_ID=012xx00000123             # if using record types

# ─── Event Handler Toggles ────────────────────────────────────
HANDLE_CALL_RINGING=true
HANDLE_CALL_ANSWERED=false                             # often noisy, can disable
HANDLE_CALL_IN_PROGRESS=false
HANDLE_CALL_ENDED=true
HANDLE_CALL_EXTRACTED=true
HANDLE_LEAD_QUALIFIED=true
HANDLE_LEAD_NEEDS_REVIEW=true
HANDLE_EVALUATION_COMPLETE=true
HANDLE_RECORDING_OGG=true
# (default: only the explicitly true ones run handlers; rest are no-ops + logged)

# ─── Generic Webhook Forwarder (alternative adapter) ──────────
GENERIC_WEBHOOK_URL=https://hooks.zapier.com/...
GENERIC_WEBHOOK_SECRET=                                 # optional outbound HMAC
GENERIC_WEBHOOK_TRANSFORM=litify-shape                 # raw | flat | litify-shape

# ─── Reliability ──────────────────────────────────────────────
MAX_RETRIES=10
RETRY_BASE_DELAY_MS=1000
RETRY_MAX_DELAY_MS=300000                              # 5 min
DEAD_LETTER_AFTER_DAYS=7

# ─── Admin ────────────────────────────────────────────────────
ADMIN_PASSWORD=...                                     # for /admin access
SLACK_ALERT_WEBHOOK_URL=                               # optional, for dead-letter alerts

# ─── Observability ────────────────────────────────────────────
MIRROR_TO_PLATFORM_API=true                            # disable for local dev
LOG_LEVEL=info                                         # debug | info | warn | error
```

---

## 8. Observability & Logging

### 8.1 What CallSofia Sees

Every event the bridge processes generates **two** entries in `activity_logs` on the platform-api side:

1. `bridge.event_received` — fires on POST receipt, includes `event_id`, `event_type`, `received_at`
2. `bridge.handler_<outcome>` — fires after processing, includes `outcome`, `crm_record_id`, `latency_ms`, `error` if applicable

This means a CallSofia operator can run:

```sql
-- "Did all events for org X in the last hour get processed?"
SELECT
  e.event_id,
  e.event_type,
  e.created_at AS callsofia_emitted_at,
  recv.created_at AS bridge_received_at,
  done.created_at AS bridge_processed_at,
  done.event_data->>'outcome' AS outcome,
  done.event_data->>'error' AS error
FROM webhook_deliveries e
LEFT JOIN activity_logs recv ON recv.event_data->>'event_id' = e.event_id::text
                             AND recv.event_type = 'bridge.event_received'
LEFT JOIN activity_logs done ON done.event_data->>'event_id' = e.event_id::text
                             AND done.event_type LIKE 'bridge.handler_%'
WHERE e.org_id = '<acmelaw>'
  AND e.created_at > NOW() - INTERVAL '1 hour'
ORDER BY e.created_at DESC;
```

If `recv.created_at IS NULL` → CallSofia sent it but bridge never confirmed receipt → bridge is unhealthy.
If `done.created_at IS NULL` → bridge received but never processed → handler stuck.

### 8.2 What the Client Sees (via /admin)

A Next.js dashboard at the bridge URL with:
- Recent event timeline
- Failure stream with replay button
- Health status (Litify connected? Queue working? Postgres healthy?)
- Daily counts by event type
- Latency distribution

### 8.3 Alerting

- Dead-letter event → POST to `SLACK_ALERT_WEBHOOK_URL` (if configured)
- Auth failure to Litify → Slack alert + halt processing for 1 minute (back-off)
- Postgres down → Vercel automatically alerts
- Queue depth > 1000 → Slack alert

---

## 9. Reliability & Failure Handling

### 9.1 Failure Domains

| Failure | Detection | Response |
|---|---|---|
| HMAC verification fails | At receive | 401, do not persist, log warn |
| Postgres unavailable | INSERT throws | 500 to caller (CallSofia retries) |
| Vercel Queue down | Enqueue throws | Fall back to `retry_queue` table, processed by cron |
| Litify rate limit (429) | Response code | Respect `Retry-After`, requeue with delay |
| Litify auth (401) | Response code | Refresh token, retry once; if still failing, halt + alert |
| Litify 5xx | Response code | Exponential backoff, max 3 retries |
| Litify 4xx (other) | Response code | Dead-letter, do not retry, alert |
| Custom field missing | SF "INVALID_FIELD" error | Dead-letter, alert (bridge mis-configured) |
| Handler throws | Try-catch in consumer | Increment retry, schedule next attempt |
| Idempotency violation (duplicate insert) | Postgres unique violation | Treat as success (it's a retry) |

### 9.2 Retry Strategy

- **Max attempts:** 10 per event-handler pair
- **Backoff:** Exponential with jitter — `min(BASE_DELAY * 2^(attempt-1), MAX_DELAY) * (0.75 + random*0.5)`
- **Dead letter:** After max attempts, status moves to `dead_letter` and Slack alert fires. Manual replay possible via `/admin/replay`.
- **Idempotency window:** 24 hours in Redis. Postgres `events.event_id` PRIMARY KEY is the durable backstop.

### 9.3 Recovery Scenarios

**Scenario: Bridge was down for 1 hour, CallSofia couldn't deliver.**
- CallSofia's webhook delivery has 10 retries with exponential backoff (~14 min total), so events emitted within ~14 min before the outage will eventually deliver
- For older events: CallSofia operator runs `POST /v1/webhooks/replay` with date range, our system re-emits

**Scenario: Bridge received but Litify was down.**
- Events sit in `deliveries` with status `retrying`
- Cron runs `/api/cron/process-retries` every 60s, picks up `retry_queue` entries where `scheduled_for < NOW()`

**Scenario: Bridge received and processed, but client wants to re-import.**
- `/admin/replay` UI: select event types + date range → bulk re-enqueue → handlers run again with idempotency keys, so SF Upserts replace existing records

---

## 10. Security

### 10.1 Inbound (CallSofia → Bridge)

- HMAC-SHA256 signature verification on every request (`X-CallSofia-Signature`)
- Timestamp freshness check (`X-CallSofia-Timestamp` within 5 min)
- `WEBHOOK_SECRET` rotated every 90 days (CallSofia supports zero-downtime rotation per the existing webhook design)
- Reject any non-2xx envelope or malformed JSON

### 10.2 Outbound (Bridge → CRM)

- **Salesforce:** OAuth 2.0 Client Credentials Flow. Tokens cached in Redis with `expires_at - 5min` safety margin. Connected App configured with minimum required permissions (Object access only on Litify objects + standard `Task`/`Contact`/`Account`/`ContentDocument`).
- **Generic Webhook:** Optional outbound HMAC signing using `GENERIC_WEBHOOK_SECRET`.

### 10.3 Bridge → CallSofia

- Standard CallSofia API key (`sk_prod_<org>_<random>`) sent via `X-API-Key` header
- Scoped to the org only (existing `validate_api_key` middleware enforces this)

### 10.4 Secrets Management

- All secrets in Vercel env vars (encrypted at rest, scoped to deployment)
- No secrets in code, git, or logs
- Per-environment: `Production` (main), `Preview` (PRs), `Development` (local)

### 10.5 Admin Surface

- `/admin/*` protected by `ADMIN_PASSWORD` env var (single-password basic auth via Next.js middleware)
- Optional: Vercel's built-in Password Protection for the whole project

### 10.6 Security Library Choices

Following secure-by-default principles:
- **Helmet** (`helmet` npm package) — security headers on Next.js responses
- **Built-in Node.js `crypto.timingSafeEqual`** for HMAC comparison (no custom string-equality)
- **`zod`** for envelope validation (rejects malformed JSON without throwing parse errors)
- **`jsforce`** for Salesforce API (well-maintained, handles OAuth refresh natively)
- **No `eval`, no template-string SQL** — all DB writes via parameterized queries (we'll use `postgres.js` or `drizzle-orm`)
- **`safe-regex`** for any user-configurable regex patterns (catastrophic backtracking detection)

---

## 11. Deployment & CI/CD

### 11.1 Repo Layout

```
callsofia-bridge/
├── README.md
├── package.json
├── tsconfig.json
├── vercel.ts                     # vercel.ts config (replaces vercel.json)
├── next.config.ts
├── drizzle.config.ts             # ORM config
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── webhooks/
│   │   │   │   └── callsofia/
│   │   │   │       └── route.ts       # POST receiver
│   │   │   ├── queue/
│   │   │   │   └── consumer/
│   │   │   │       └── route.ts       # Queue consumer
│   │   │   ├── cron/
│   │   │   │   ├── process-retries/route.ts
│   │   │   │   └── health-check/route.ts
│   │   │   └── admin/
│   │   │       └── replay/route.ts
│   │   ├── admin/
│   │   │   ├── layout.tsx
│   │   │   ├── page.tsx
│   │   │   ├── events/[event_id]/page.tsx
│   │   │   ├── failures/page.tsx
│   │   │   ├── health/page.tsx
│   │   │   └── replay/page.tsx
│   │   └── layout.tsx
│   ├── lib/
│   │   ├── adapters/
│   │   │   ├── types.ts              # CrmAdapter interface
│   │   │   ├── litify/
│   │   │   │   ├── adapter.ts
│   │   │   │   ├── auth.ts           # OAuth + token cache
│   │   │   │   ├── intake.ts         # Intake CRUD
│   │   │   │   ├── person.ts         # Person CRUD
│   │   │   │   ├── activity.ts       # Task/Activity CRUD
│   │   │   │   ├── recording.ts      # ContentDocument upload
│   │   │   │   ├── case-type-cache.ts
│   │   │   │   └── field-mapping.ts
│   │   │   ├── generic-webhook/
│   │   │   │   ├── adapter.ts
│   │   │   │   └── transforms.ts
│   │   │   └── registry.ts           # Adapter selection by env var
│   │   ├── platform-api/
│   │   │   ├── client.ts
│   │   │   └── activity-logs.ts
│   │   ├── webhook/
│   │   │   ├── verify.ts             # HMAC verification
│   │   │   ├── envelope.ts           # Zod schemas
│   │   │   └── types.ts
│   │   ├── queue/
│   │   │   ├── publisher.ts
│   │   │   └── consumer.ts
│   │   ├── db/
│   │   │   ├── schema.ts             # Drizzle schema
│   │   │   ├── client.ts
│   │   │   └── migrations/
│   │   ├── redis/
│   │   │   └── client.ts
│   │   ├── logger.ts
│   │   └── config.ts                 # Env var parsing & validation (zod)
│   └── tests/
│       ├── webhook/verify.test.ts
│       ├── adapters/litify/*.test.ts
│       └── adapters/litify/__fixtures__/
├── scripts/
│   ├── litify/
│   │   ├── create-custom-fields.sh   # sf CLI script
│   │   ├── verify-org.sh
│   │   └── case-type-seed.sh
│   └── replay-events.ts              # Bulk replay CLI
├── docs/
│   ├── README.md
│   ├── litify-setup-guide.md
│   ├── deployment.md
│   ├── troubleshooting.md
│   └── adding-a-crm-adapter.md
└── .github/
    └── workflows/
        ├── ci.yml                    # tests + lint on PR
        └── deploy.yml                # auto-deploy on main → Vercel (via Vercel GitHub integration)
```

### 11.2 CI/CD Flow

- **PR opened:** GitHub Actions runs `pnpm test`, `pnpm lint`, `pnpm typecheck`. Vercel creates Preview deployment with `NEXT_PUBLIC_PREVIEW=true`.
- **Merged to `main`:** Vercel auto-deploys to Production. Database migrations run via Vercel Build Step (`drizzle-kit push`).
- **Rollback:** Vercel's instant rollback feature (one-click in dashboard).

### 11.3 First-Time Client Onboarding Checklist

Documented in `docs/deployment.md`:

1. Fork `callsofia-bridge` repo (or use Vercel's "Deploy" button which forks it)
2. Connect GitHub repo to a new Vercel project
3. Provision Vercel Marketplace integrations: Neon Postgres + Upstash Redis
4. Run `scripts/litify/create-custom-fields.sh` against client's Salesforce org
5. Create Salesforce Connected App, note client_id/secret
6. Set all env vars in Vercel (template provided in `.env.example`)
7. Get `CALLSOFIA_API_KEY` + `CALLSOFIA_WEBHOOK_SECRET` from CallSofia operator
8. Push to main → first deployment runs migrations
9. Register bridge URL in CallSofia dashboard webhooks
10. CallSofia operator places test call → verify event flows to Litify Intake

---

## 12. Testing Strategy

### 12.1 Unit Tests

- HMAC verify: signed/unsigned/tampered/expired
- Envelope parsing: malformed JSON, missing fields, schema_version mismatch
- Each Litify field mapper: extracted_vars → Litify SObject fields
- Case type lookup with cache hit / cache miss / unknown type
- Idempotency: duplicate event_id rejected at receive AND at consume
- Retry scheduling: backoff calculation, jitter bounds

### 12.2 Integration Tests

- End-to-end flow with **Salesforce sandbox**: receive event → Litify Intake created → fields populated correctly
- Use the **9 example payloads** from `callsofia-webhooks-docs/examples/payloads/` as test fixtures
- Replay all 18 event types and verify expected Litify operations

### 12.3 Mock Server for Local Dev

`scripts/dev/mock-callsofia.ts` — replays canned events to your local bridge, useful for offline testing.

### 12.4 Production Smoke Tests

Cron job `/api/cron/health-check` runs every 5 minutes:
- Postgres SELECT 1
- Redis PING
- Litify SOQL `SELECT Id FROM litify_pm__Intake__c LIMIT 1`
- Platform API `GET /v1/health`
- Writes result to `activity_logs` as `bridge.health_check`

---

## 13. Open Questions / Future Work

### Phase 1.5 (post-launch)

- HubSpot adapter (parallel to Litify)
- Two-way sync: bridge subscribes to Salesforce Platform Events to push back to CallSofia (e.g., when attorney updates intake status)
- Per-pipeline handler config (different behavior for different CallSofia pipelines within one org)

### Phase 2

- Multi-tenant variant for clients who want one bridge for multiple Litify orgs
- Visual mapping editor in `/admin` so clients can adjust field mappings without code
- Native Filevine + MyCase + Clio adapters
- Self-hosted CRM data lake adapter (write to S3/BigQuery for client analytics)

### Decisions Deferred

- **Volume/scale assumptions** — assumed < 1000 events/hour per client, which Vercel Functions handle with capacity to spare. Revisit if a client exceeds.
- **GDPR/data residency** — current design stores raw payloads in Neon (US region by default). If a client needs EU-only, deploy to Vercel EU region + Neon EU region.
- **Recording storage** — currently we just upload to Salesforce ContentDocument. For clients who want their own S3 bucket, future env var: `RECORDING_FORWARD_S3_BUCKET`.

---

## 14. What's NOT in scope (explicitly)

- **Building a CallSofia↔CRM bidirectional sync** — bridge is one-way (events → CRM)
- **Replacing CallSofia's first-party webhook delivery** — the bridge is downstream of it
- **A SaaS-style admin UI for non-developer firm staff** — env-var driven only
- **Custom call-routing logic** — that lives in CallSofia, not the bridge
- **Multi-CRM per single deployment** — one adapter per deploy

---

## Appendix A — Full Litify Adapter Code Sketch

```typescript
// src/lib/adapters/litify/adapter.ts
import jsforce from "jsforce";
import { CrmAdapter, AdapterContext, HandlerResult } from "../types";
import { CallSofiaEvent } from "../../webhook/types";
import { LitifyAuth } from "./auth";
import { LitifyIntake } from "./intake";
import { LitifyPerson } from "./person";
import { LitifyActivity } from "./activity";
import { mapCaseType, mapStatus, mapExtractedVars } from "./field-mapping";

export class LitifyAdapter implements CrmAdapter {
  readonly name = "litify";
  private conn: jsforce.Connection | null = null;

  constructor(private auth: LitifyAuth) {}

  async init(): Promise<void> {
    this.conn = await this.auth.getConnection();
  }

  async healthCheck(): Promise<HealthStatus> {
    const conn = await this.auth.getConnection();
    await conn.query("SELECT Id FROM litify_pm__Intake__c LIMIT 1");
    return { healthy: true, timestamp: new Date() };
  }

  async handle(event: CallSofiaEvent, ctx: AdapterContext): Promise<HandlerResult> {
    const conn = await this.auth.getConnection();
    const intakeOps = new LitifyIntake(conn, ctx);
    const personOps = new LitifyPerson(conn, ctx);
    const activityOps = new LitifyActivity(conn, ctx);

    const callId = event.payload.call_id ?? event.payload.room_name;
    const phone = event.payload.caller_phone ?? event.payload.from_phone;

    switch (event.event_type) {
      case "call.ringing": {
        const person = await personOps.findByPhone(phone);
        if (!person) return { outcome: "noop", message: "No existing person" };
        const task = await activityOps.startInboundCall({
          personId: person.Id,
          callId,
          twilioSid: event.payload.twilio_call_sid,
        });
        return { outcome: "success", crm_record_id: task.id };
      }

      case "call.ended": {
        const person = await personOps.upsertByPhone(phone, {});
        const intake = await intakeOps.create({
          personId: person.Id,
          callId,
          callerPhone: phone,
          startedAt: event.payload.started_at,
          endedAt: event.payload.ended_at,
          duration: event.payload.duration,
          language: event.payload.language,
          caseType: mapCaseType(event.payload.case_type),
          twilioSid: event.payload.twilio_call_sid,
        });
        await activityOps.completeCall({
          callId,
          duration: event.payload.duration,
          intakeId: intake.id,
        });
        return { outcome: "success", crm_record_id: intake.id };
      }

      case "call.extracted": {
        const fields = mapExtractedVars(event.payload.extracted_vars);
        const intake = await intakeOps.upsertByCallId(callId, {
          ...fields,
          CallSofia_Summary__c: event.payload.summary,
          CallSofia_Last_Synced_At__c: new Date().toISOString(),
        });
        return { outcome: "success", crm_record_id: intake.id };
      }

      case "lead.qualified": {
        const intake = await intakeOps.upsertByCallId(callId, {
          litify_pm__Status__c: "Qualified",
          Rating__c: "Hot",
          CallSofia_Quality_Score__c: event.payload.evaluation?.score,
        });
        if (process.env.LITIFY_AUTO_CONVERT_QUALIFIED === "true") {
          await intakeOps.triggerConversionFlow(intake.id);
        }
        return { outcome: "success", crm_record_id: intake.id };
      }

      case "lead.needs_review": {
        const intake = await intakeOps.upsertByCallId(callId, {
          litify_pm__Status__c: "Needs Review",
          OwnerId: process.env.INTAKE_COORDINATOR_USER_ID,
          Description: `NEEDS REVIEW: ${event.payload.review_reason}\n\n${event.payload.summary}`,
        });
        return { outcome: "success", crm_record_id: intake.id };
      }

      case "evaluation.complete": {
        const intake = await intakeOps.upsertByCallId(callId, {
          CallSofia_Quality_Score__c: event.payload.evaluation.score,
        });
        return { outcome: "success", crm_record_id: intake.id };
      }

      case "recording.ogg": {
        const intake = await intakeOps.findByCallId(callId);
        if (!intake) return { outcome: "noop", message: "No intake to attach recording" };
        const recId = await intakeOps.attachRecording(intake.id, {
          downloadUrl: event.payload.download_url,
          fileSize: event.payload.file_size_bytes,
        });
        return { outcome: "success", crm_record_id: recId };
      }

      default:
        return { outcome: "noop", message: `No handler for ${event.event_type}` };
    }
  }
}
```

---

## Approval Gate

Per the brainstorming skill, this design is **draft pending approval**. Once approved, the next step is to invoke `superpowers:writing-plans` to produce the phased implementation plan.
