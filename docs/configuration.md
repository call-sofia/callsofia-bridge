# Configuration Reference

Every environment variable the bridge reads, what it does, what it defaults to, and what happens when you leave it unset. The source of truth is the Zod schema in [`src/lib/config.ts`](../src/lib/config.ts) — this document mirrors it. If the two ever drift, the code wins; please open a PR.

## Table of Contents

- [How configuration is loaded](#how-configuration-is-loaded)
- [CallSofia connection (required)](#callsofia-connection-required)
- [Storage (required)](#storage-required)
- [CRM Adapter selection](#crm-adapter-selection)
- [Litify auth](#litify-auth)
- [Litify behavior](#litify-behavior)
- [Event handler toggles](#event-handler-toggles)
- [Generic webhook forwarder](#generic-webhook-forwarder)
- [Reliability](#reliability)
- [Admin](#admin)
- [Observability](#observability)
- [Vercel-specific](#vercel-specific)
- [Marketplace integrations](#marketplace-integrations)

## How configuration is loaded

`loadConfig()` parses `process.env` once per process via Zod. Bad config fails fast at boot — the function throws with a structured error pointing at the offending field. The result is memoised in `config()`.

If you change an env var, you must redeploy (Vercel) or restart the dev server. The cache is per-process; there is no hot reload.

## CallSofia connection (required)

Connection details for the upstream platform-api.

| Variable | Type | Required | Default | Example | What it does |
|---|---|---|---|---|---|
| `CALLSOFIA_API_BASE_URL` | URL | yes | — | `https://api.callsofia.co` | Base URL for outbound calls (`/v1/logs`, `/v1/calls/:id`, `/v1/leads/:id`). Use `https://dev.api.callsofia.co` for the DEV environment. |
| `CALLSOFIA_ORG_ID` | UUID | yes | — | `10000000-0000-0000-0000-000000000001` | Your CallSofia organisation UUID. Recorded with every event for downstream filtering. |
| `CALLSOFIA_API_KEY` | string (≥8) | yes | — | `sk_prod_acmelaw_xxx` | Sent as `X-API-Key` on every outbound call to platform-api. Stripe-style format. |
| `CALLSOFIA_WEBHOOK_SECRET` | string (≥8) | yes | — | `whsec_REPLACE_ME` | HMAC-SHA256 secret used to verify inbound webhooks. Must match the secret you set in the CallSofia webhook subscription. |

If any of these are missing or malformed, `loadConfig()` throws and every route returns 500 until you fix them.

## Storage (required)

| Variable | Type | Required | Default | Example | What it does |
|---|---|---|---|---|---|
| `DATABASE_URL` | URL | yes | — | `postgres://user:pass@host:5432/db` | Postgres connection string. Used by Drizzle ORM and the migration runner. Idempotency is enforced at the `events` table primary key — no Redis or KV is needed. |

The bridge has no other storage dependency. Earlier versions also required Upstash Redis for idempotency; that was removed (see [`architecture.md`](./architecture.md#idempotency)).

## CRM Adapter selection

| Variable | Type | Required | Default | Example | What it does |
|---|---|---|---|---|---|
| `CRM_ADAPTER` | enum | yes | — | `litify` | Selects the downstream adapter. Valid: `litify`, `generic-webhook`, `none`. |

**When to use which:**

- `none` — recommended first run. Events land in the `events` table and `bridge.handler_noop` deliveries are recorded, but no external CRM is contacted. Use this to verify connectivity end-to-end before introducing a CRM. See [`getting-started.md`](./getting-started.md).
- `litify` — production adapter for Litify (Salesforce). Requires the [Litify auth](#litify-auth) and [Litify behavior](#litify-behavior) sections below. See [`integrations/litify.md`](./integrations/litify.md).
- `generic-webhook` — POSTs each event to a URL of your choice with optional HMAC signing. Useful for pushing to Zapier, n8n, or your own endpoint. See [`integrations/generic-webhook.md`](./integrations/generic-webhook.md) and the [Generic webhook forwarder](#generic-webhook-forwarder) section below.

The selected adapter is loaded lazily and cached — switching requires a redeploy.

## Litify auth

Salesforce OAuth 2.0 Client Credentials Flow. Configure a Connected App in your Salesforce org with **Enable Client Credentials Flow** + a run-as user. See [`integrations/litify.md`](./integrations/litify.md) for the full Salesforce setup.

| Variable | Type | Required | Default | Example | What it does |
|---|---|---|---|---|---|
| `SALESFORCE_LOGIN_URL` | URL | only if `CRM_ADAPTER=litify` | — | `https://login.salesforce.com` | OAuth token endpoint base. Use `https://test.salesforce.com` for sandboxes. |
| `SALESFORCE_CLIENT_ID` | string | only if `CRM_ADAPTER=litify` | — | `3MVG9...` | Connected App Consumer Key. Presence of this var is what tells the bridge to populate the `salesforce` config block at all. |
| `SALESFORCE_CLIENT_SECRET` | string | only if `CRM_ADAPTER=litify` | — | `…` | Connected App Consumer Secret. |
| `SALESFORCE_USERNAME` | string | **deprecated** | — | — | Legacy username/password flow field. Setting any of these emits a runtime warning. Will be removed in a future release. |
| `SALESFORCE_PASSWORD` | string | **deprecated** | — | — | Legacy. Do not set. |
| `SALESFORCE_SECURITY_TOKEN` | string | **deprecated** | — | — | Legacy. Do not set. |

If `SALESFORCE_CLIENT_ID` is unset, the entire `salesforce` config block is `undefined` — the Litify adapter will throw on init and the health check will report unhealthy. The bridge will still receive and persist events, just won't be able to forward them.

## Litify behavior

| Variable | Type | Required | Default | Example | What it does |
|---|---|---|---|---|---|
| `LITIFY_AUTO_CONVERT_QUALIFIED` | bool | no | `false` | `true` | When `true`, qualified leads are auto-converted to Litify Matters. Otherwise they stay as Intakes for manual review. |
| `INTAKE_DEFAULT_OWNER_ID` | string (SF Id) | no | — | `005…` | Salesforce User Id assigned as `OwnerId` on new Intakes. If unset, ownership defaults to the API user. |
| `INTAKE_COORDINATOR_USER_ID` | string (SF Id) | no | — | `005…` | Salesforce User Id stored as the intake coordinator on the Intake record. |
| `LITIFY_INTAKE_RECORD_TYPE_ID` | string (SF Id) | no | — | `012…` | RecordTypeId for the Intake object. Required if your org uses multiple record types. |
| `LITIFY_RECORDING_MODE` | enum | no | `url` | `attach` | `url`: store the presigned S3 URL on `Intake.CallSofia_Recording_URL__c` (cheap, URL eventually expires). `attach`: download the OGG and upload as a Salesforce ContentVersion (self-contained, but base64-loads the file — OOM risk on Vercel for >~25 MB recordings). |

## Event handler toggles

Per-event-type on/off switches. When a toggle is `false`, the receiver still persists the event to the `events` table, but the queue consumer records a `noop` delivery and skips the adapter call. The mapping below comes from `handlerToggle` in [`src/app/api/queue/consumer/route.ts`](../src/app/api/queue/consumer/route.ts):

| Env var | Default | event_type queued for processing |
|---|---|---|
| `HANDLE_CALL_RINGING` | `false` | `call.ringing` |
| `HANDLE_CALL_ANSWERED` | `false` | `call.answered` |
| `HANDLE_CALL_IN_PROGRESS` | `false` | `call.in_progress` |
| `HANDLE_CALL_ENDED` | `true` | `call.ended` |
| `HANDLE_CALL_EXTRACTED` | `true` | `call.extracted` |
| `HANDLE_LEAD_QUALIFIED` | `true` | `lead.qualified` |
| `HANDLE_LEAD_NEEDS_REVIEW` | `true` | `lead.needs_review` |
| `HANDLE_EVALUATION_COMPLETE` | `true` | `evaluation.complete` |
| `HANDLE_RECORDING_OGG` | `true` | `recording.ogg` |

Event types not in this table (e.g. `call.transferred`, `evaluation.failed`, `call.outbound_request`) have no toggle and always run the adapter. See the full event catalogue in [`payload-spec.md`](./payload-spec.md#event-types).

## Generic webhook forwarder

Configuration for `CRM_ADAPTER=generic-webhook`.

| Variable | Type | Required | Default | Example | What it does |
|---|---|---|---|---|---|
| `GENERIC_WEBHOOK_URL` | URL | only if `CRM_ADAPTER=generic-webhook` | — | `https://hooks.example.com/callsofia` | Where to POST each event. |
| `GENERIC_WEBHOOK_SECRET` | string | no | — | `whsec_…` | Optional HMAC-SHA256 secret. When set, the adapter signs outbound requests with the same `timestamp.body` scheme the bridge itself accepts. |
| `GENERIC_WEBHOOK_TRANSFORM` | enum | no | `raw` | `litify-shape` | `raw`: forward the full envelope. `flat`: flatten `data.payload` to top-level. `litify-shape`: pre-shape into the field names the Litify adapter would use, useful for Zapier-style consumers that mimic Salesforce. |

## Reliability

Retry/backoff knobs for failed adapter calls. Used by `computeBackoff()` in [`src/lib/queue/consumer.ts`](../src/lib/queue/consumer.ts) and the dead-letter logic in the consumer route.

| Variable | Type | Required | Default | Example | What it does |
|---|---|---|---|---|---|
| `MAX_RETRIES` | int | no | `10` | `5` | Max retry attempts before an event is dead-lettered. The 10th retry roughly delays ~5 minutes after the first failure. |
| `RETRY_BASE_DELAY_MS` | int | no | `1000` | `2000` | Base delay for exponential backoff. Attempt N delay ≈ `base * 2^(N-1)`, jittered ±25%. |
| `RETRY_MAX_DELAY_MS` | int | no | `300000` | `60000` | Cap on retry delay (5 minutes by default). |
| `DEAD_LETTER_AFTER_DAYS` | int | no | `7` | `14` | Currently informational — used by future cleanup jobs to prune dead-lettered rows. |

## Admin

| Variable | Type | Required | Default | Example | What it does |
|---|---|---|---|---|---|
| `ADMIN_PASSWORD` | string (≥8) | yes | — | `s0meStr0ngP4ss` | Basic-auth password for `/admin` and the replay endpoint. If unset, `/admin` returns 500 ("Server misconfigured"). |
| `SLACK_ALERT_WEBHOOK_URL` | URL | no | — | `https://hooks.slack.com/...` | Optional. When set, dead-letter events and persistent unhealthy adapters post to this Slack webhook. |

## Observability

| Variable | Type | Required | Default | Example | What it does |
|---|---|---|---|---|---|
| `MIRROR_TO_PLATFORM_API` | bool | no | `true` | `false` | Mirror every event + handler outcome to platform-api `/v1/logs`. Set `false` to disable cross-side observability (saves outbound calls, but you lose the audit trail). |
| `LOG_LEVEL` | enum | no | `info` | `debug` | One of `debug`, `info`, `warn`, `error`. Controls the structured logger. |

## Vercel-specific

| Variable | Type | Required | Default | Example | What it does |
|---|---|---|---|---|---|
| `VERCEL_QUEUE_PUBLISH_URL` | URL | no | — | `https://queue.vercel-app.com/...` | Vercel Queues publish endpoint. When set, the receiver enqueues there and Vercel invokes `/api/queue/consumer`. When unset, the bridge falls back to an in-process fetch to its own consumer route. |
| `QUEUE_TOKEN` | string | conditional | — | `…` | Bearer token sent to the Vercel Queues publish endpoint. Required when `VERCEL_QUEUE_PUBLISH_URL` is set. |
| `QUEUE_INTERNAL_TOKEN` | string | recommended (in-process fallback) | — | `random-hex` | When set, `/api/queue/consumer` requires this in `x-queue-token`. Stops anyone from POSTing forged messages to your consumer route. The receiver always sends it. |
| `NEXT_PUBLIC_BASE_URL` | URL | required if `VERCEL_QUEUE_PUBLISH_URL` is unset | `http://localhost:3000` | `https://your-bridge.vercel.app` | Base URL the in-process consumer fallback POSTs back to. **You must set this in production** if you don't use Vercel Queues — otherwise the fallback hits `localhost:3000` and silently fails. |

## Marketplace integrations

Optional Vercel Marketplace integrations that simplify provisioning:

- **Neon Postgres** (recommended) — auto-injects `DATABASE_URL` and a few `POSTGRES_*` aliases. The bridge only reads `DATABASE_URL`.
- **Upstash Redis** — historically required, now unused. The bridge no longer reads `REDIS_URL` or `REDIS_TOKEN`. You can remove the integration if you only added it for the bridge.
- **Vercel Queues** — optional. When enabled, set `VERCEL_QUEUE_PUBLISH_URL` and `QUEUE_TOKEN`. Without it, the bridge uses an in-process fallback that re-invokes its own consumer route via fetch.

For deployment specifics (CLI commands, custom domains, rollback) see [`deployment.md`](./deployment.md). For the architectural rationale behind each component see [`architecture.md`](./architecture.md).
