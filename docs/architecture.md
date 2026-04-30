# Architecture

A one-page tour of how the bridge ingests, persists, and forwards CallSofia webhooks. For the long-form rationale (component-by-component design discussions, alternatives considered), read [`DESIGN.md`](./DESIGN.md). This document is the operational view.

## Table of Contents

- [Pipeline at a glance](#pipeline-at-a-glance)
- [Components](#components)
- [Data model](#data-model)
- [Idempotency](#idempotency)
- [Retry semantics](#retry-semantics)
- [Atomic retry-claim](#atomic-retry-claim)
- [HMAC scheme](#hmac-scheme)
- [Observability](#observability)
- [What the bridge is not](#what-the-bridge-is-not)

## Pipeline at a glance

```
                          POST signed JSON
   CallSofia platform-api ─────────────────▶ /api/webhooks/callsofia
                                              ├─ verify HMAC                  src/lib/webhook/verify.ts
                                              ├─ parse envelope                src/lib/webhook/envelope.ts
                                              ├─ INSERT events ON CONFLICT     src/app/api/webhooks/callsofia/route.ts
                                              │      DO NOTHING RETURNING
                                              ├─ fire-and-forget mirror ─────▶ platform-api /v1/logs
                                              │                                 src/lib/platform-api/client.ts
                                              └─ enqueue ────────────┐
                                                                     ▼
                                              Vercel Queues  ── or ──   in-process fetch fallback
                                              (when configured)         src/lib/queue/publisher.ts
                                                                     │
                                                                     ▼
                                              /api/queue/consumer
                                              ├─ load events row              src/app/api/queue/consumer/route.ts
                                              ├─ check HANDLE_* toggle        src/lib/config.ts
                                              ├─ select adapter               src/lib/adapters/registry.ts
                                              ├─ adapter.handle(event)        src/lib/adapters/{litify,generic-webhook}/...
                                              ├─ INSERT deliveries
                                              ├─ mirror outcome ─────────────▶ platform-api /v1/logs
                                              └─ on retry: setTimeout + re-publish

   Vercel Cron */1 * * * *  ─▶ /api/cron/process-retries
                              ├─ DELETE FROM retry_queue ... SKIP LOCKED      src/app/api/cron/process-retries/route.ts
                              └─ re-publish each claimed row

   Vercel Cron */5 * * * *  ─▶ /api/cron/health-check
                              ├─ SELECT 1 (postgres)                          src/app/api/cron/health-check/route.ts
                              ├─ adapter.healthCheck()
                              └─ mirror result ──────────────────────────────▶ platform-api /v1/logs
```

The bridge has **no LLM dependency** — pure deterministic adapter logic. No background workers either; everything is request- or cron-driven so the whole thing fits inside Vercel Functions.

## Components

| Component | File(s) | Responsibility |
|---|---|---|
| **Receiver** | [`src/app/api/webhooks/callsofia/route.ts`](../src/app/api/webhooks/callsofia/route.ts) | Verify HMAC + freshness; persist event; mirror to platform-api; enqueue. Returns 200 in <500 ms. |
| **Envelope parser** | [`src/lib/webhook/envelope.ts`](../src/lib/webhook/envelope.ts) | Accepts both nested (`data:{scope,payload}`) and flat (`data:{...fields}`) shapes. Normalises to nested. |
| **Signature verifier** | [`src/lib/webhook/verify.ts`](../src/lib/webhook/verify.ts) | `HMAC-SHA256(secret, "{ts}.{body}")`, constant-time compare. Accepts UNIX seconds, milliseconds, or ISO 8601 timestamps. |
| **Ledger** | `events` table — schema in [`src/lib/db/schema.ts`](../src/lib/db/schema.ts) | Append-only record of every received event. PK on `event_id` doubles as the idempotency guard. |
| **Queue publisher** | [`src/lib/queue/publisher.ts`](../src/lib/queue/publisher.ts) | POSTs to Vercel Queues if `VERCEL_QUEUE_PUBLISH_URL` is set; otherwise direct fetch to `/api/queue/consumer`. |
| **Consumer** | [`src/app/api/queue/consumer/route.ts`](../src/app/api/queue/consumer/route.ts) | Loads event; checks `HANDLE_*` toggle; calls adapter; persists `deliveries` row; schedules retry on failure. |
| **Adapter registry** | [`src/lib/adapters/registry.ts`](../src/lib/adapters/registry.ts) | Lazy-loads `litify`, `generic-webhook`, or `none`. Caches the instance. |
| **CRM adapters** | `src/lib/adapters/litify/`, `src/lib/adapters/generic-webhook/` | Implement `CrmAdapter` interface ([`src/lib/adapters/types.ts`](../src/lib/adapters/types.ts)) — `init`, `handle`, `healthCheck`. |
| **Retry sweep** | [`src/app/api/cron/process-retries/route.ts`](../src/app/api/cron/process-retries/route.ts) | Every minute, atomically claims due rows from `retry_queue` and re-publishes them. |
| **Health cron** | [`src/app/api/cron/health-check/route.ts`](../src/app/api/cron/health-check/route.ts) | Every 5 minutes, runs Postgres + adapter health probes and mirrors results. |
| **Admin UI** | `src/app/admin/*` | Next.js pages for inspecting recent events, failures, and triggering manual replays. Basic-auth via middleware. |
| **Platform API client** | [`src/lib/platform-api/client.ts`](../src/lib/platform-api/client.ts), [`src/lib/platform-api/activity-logs.ts`](../src/lib/platform-api/activity-logs.ts) | Mirrors events + outcomes to `/v1/logs`. Source-allowlist aware (`source="webhook"`). |

## Data model

Drizzle schema lives in [`src/lib/db/schema.ts`](../src/lib/db/schema.ts). Four tables, no relations beyond a single FK.

### `events` — append-only ledger

| Column | Type | Notes |
|---|---|---|
| `event_id` | uuid PK | Supplied by sender; doubles as idempotency key. |
| `event_type` | text | Indexed. See [event catalogue](./payload-spec.md#event-types). |
| `emitted_at` | timestamptz | Sender-supplied. |
| `received_at` | timestamptz | Server clock. Indexed. |
| `schema_version` | smallint | Always recorded verbatim from sender. |
| `scope` | jsonb | `{org_id, workspace_id, pipeline_id, stage_id}` — defaults to all-zero UUIDs for the flat platform-api shape. |
| `payload` | jsonb | Event body. |
| `raw_envelope` | jsonb | Verbatim copy of the inbound JSON for replay. |
| `signature_valid` | bool | Always `true` for rows that get inserted (invalid sigs 401 before insert). |
| `status` | text | `received` initially. Currently informational. Indexed. |

### `deliveries` — per-handler outcomes

| Column | Type | Notes |
|---|---|---|
| `id` | bigserial PK | |
| `event_id` | uuid FK → `events.event_id` ON DELETE CASCADE | |
| `handler_id` | text | Adapter name. |
| `attempt` | int | 1-based. |
| `status` | text | `succeeded` \| `failed` \| `retrying` \| `noop`. |
| `outcome` | jsonb | The full `HandlerResult` ([`src/lib/adapters/types.ts`](../src/lib/adapters/types.ts)). |
| `crm_record_id` | text | Optional CRM-side ID returned by the adapter. |
| `error_code`, `error_message` | text | Set when `outcome.error` is present. |
| `started_at`, `completed_at`, `next_retry_at`, `created_at` | timestamptz | |

Unique constraint on `(event_id, handler_id, attempt)` — multiple attempts of the same handler are encoded as separate rows.

### `retry_queue` — scheduled re-publishes

| Column | Type | Notes |
|---|---|---|
| `id` | bigserial PK | |
| `event_id` | uuid | Not a FK — survives `events` row deletion. |
| `handler_id` | text | |
| `scheduled_for` | timestamptz | Indexed. The cron sweeps rows where `scheduled_for <= NOW()`. |
| `attempt` | int | |
| `created_at` | timestamptz | |

### `config_overrides` — runtime per-event-type config

| Column | Type | Notes |
|---|---|---|
| `event_type` | text PK | |
| `enabled` | bool | |
| `handler_id` | text | |
| `config` | jsonb | Adapter-specific overrides (currently informational). |
| `updated_at` | timestamptz | |

Currently unused by the receiver but reserved for the admin UI.

## Idempotency

The bridge does **not** use Redis or any external KV store. The `events` table primary key on `event_id` is the only guard. The receiver inserts with `ON CONFLICT DO NOTHING ... RETURNING event_id`:

```sql
INSERT INTO events (event_id, ...) VALUES ($1, ...) ON CONFLICT DO NOTHING RETURNING event_id;
```

If the row already existed, `RETURNING` yields zero rows and the receiver returns `{ok:true, duplicate:true}` without enqueueing. This single SQL statement gives us at-most-once persistence + atomic claim in one round trip. An earlier design used Upstash Redis for an idempotency cache; it was removed when this pattern proved sufficient.

## Retry semantics

When `adapter.handle()` returns `outcome: "retry"` (or throws), the consumer:

1. Inserts a `deliveries` row with `status: "retrying"` and the error details
2. Computes a delay via `computeBackoff(attempt, {baseMs, maxMs})` ([`src/lib/queue/consumer.ts`](../src/lib/queue/consumer.ts)):

   ```
   delay = min(baseMs * 2^(attempt-1), maxMs) * jitter[0.75 .. 1.25]
   ```

3. Schedules `setTimeout(() => publishEventForProcessing(eventId, attempt + 1), delay)`
4. If `attempt >= MAX_RETRIES`, the event is dead-lettered: a `bridge.dead_letter` log is emitted to platform-api, and no further retries are scheduled

`setTimeout` lives in the function instance — Vercel Fluid Compute reuses instances aggressively, but if the instance is reaped before the timer fires the retry is lost. The `retry_queue` table + `process-retries` cron exists to backstop that case for retries scheduled with a `next_retry_at`.

## Atomic retry-claim

The retry sweep cron must never let two concurrent invocations claim the same row. The pattern in [`src/app/api/cron/process-retries/route.ts`](../src/app/api/cron/process-retries/route.ts):

```sql
DELETE FROM retry_queue
WHERE id IN (
  SELECT id FROM retry_queue
  WHERE scheduled_for <= NOW()
  ORDER BY scheduled_for
  LIMIT 50
  FOR UPDATE SKIP LOCKED
)
RETURNING id, event_id, attempt;
```

`FOR UPDATE SKIP LOCKED` makes overlapping cron ticks safe — if two run within the same minute, the second sees rows that aren't already locked and grabs a disjoint set. The whole thing is one statement, so even the DELETE+SELECT is atomic.

## HMAC scheme

The bridge mirrors platform-api's signing scheme exactly:

```
signing_string = f"{timestamp}.{raw_body}"
signature      = "sha256=" + hmac_sha256(secret, signing_string).hexdigest()
```

Verification in [`src/lib/webhook/verify.ts`](../src/lib/webhook/verify.ts) reads the body as bytes (so we don't re-encode), recomputes the HMAC, and uses `crypto.timingSafeEqual()` to compare. The freshness window is 300 seconds; older timestamps return 400.

The full envelope spec, headers, and event catalogue are documented in [`payload-spec.md`](./payload-spec.md).

## Observability

The bridge is stateless. No in-memory hint buffers, no shared caches, nothing that survives a function invocation. Every interesting event mirrors to platform-api `/v1/logs` as a fire-and-forget POST:

```
                  insert events                fire-and-forget
   receiver  ────▶  Postgres        receiver ──────────────────▶ platform-api /v1/logs
       │                                          (failure logged but doesn't fail webhook)
       └─ enqueue
              │
              ▼
   consumer ────▶ adapter.handle()  consumer ──────────────────▶ platform-api /v1/logs
              │                          (mirror outcome)
              ▼
         insert deliveries
```

Mirror entries use `source="webhook"` and `metadata.source_app="callsofia-bridge"` so the platform-api log writer accepts them — see [`src/lib/platform-api/activity-logs.ts`](../src/lib/platform-api/activity-logs.ts) for the source-allowlist note. Disable mirrors with `MIRROR_TO_PLATFORM_API=false`.

For local visibility there's the `/admin` UI ([`src/app/admin/page.tsx`](../src/app/admin/page.tsx)) — a list of the 100 most recent events with deep links to per-event detail.

## What the bridge is not

- **Not an LLM** — no model calls, no embeddings, no agentic loops. Pure adapter code.
- **Not multi-tenant** — one deploy per client, by design. See [`DESIGN.md`](./DESIGN.md#2-goals--non-goals).
- **Not a two-way sync** — events flow CallSofia → CRM only. CRM-side changes don't propagate back.
- **Not a long-running worker** — every code path is request-driven (HTTP or cron). Nothing keeps a process alive between events.
