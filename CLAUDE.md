# CLAUDE.md — callsofia-bridge

> **For Claude Code (and any LLM-based pair-programmer).**
> This file is the project's "single screen briefing." Read it cover-to-cover before answering questions about this repo or making changes. Optimised for being loaded into a model's context window in one shot — every section pulls its weight.

---

## What this repo is

A standalone webhook middleware that sits between [CallSofia](https://callsofia.co)'s AI-voice intake platform and a downstream CRM (default: Litify-on-Salesforce; pluggable via the `CrmAdapter` interface). One Vercel deployment per customer; configuration is entirely env-var driven.

**Pipeline shape (8 steps):**

```
CallSofia platform-api
        │  HMAC-SHA256 signed POST to /api/webhooks/callsofia
        ▼
[1] verify signature  →  [2] check timestamp freshness (300s)
        │
        ▼
[3] parse envelope (zod) — accepts both nested {scope,payload} and flat data shapes
        │
        ▼
[4] INSERT INTO events ... ON CONFLICT (event_id) DO NOTHING RETURNING event_id
        │   (idempotency: duplicate POST returns 200 {duplicate:true} and stops here)
        ▼
[5] mirror to platform-api /v1/logs (fire-and-forget; full payload preserved)
        │
        ▼
[6] publishEventForProcessing(event_id) → Vercel Queues OR in-process fetch fallback
        │
        ▼  POST /api/queue/consumer
[7] load event row, resolve adapter, adapter.handle(event, ctx)
        │
        ▼
[8] INSERT INTO deliveries (status, outcome, crm_record_id, ...)
        │   on `retry` outcome: schedule next attempt with exponential backoff
        │   exhausted retries: log dead-letter, mirror to activity_logs
        ▼
LitifyAdapter → Salesforce / Litify (Person, Intake, Activity, ContentVersion)
```

The bridge is **stateless** other than its Postgres ledger. There is no Redis, no in-memory state, no LLM dependency. Idempotency lives in `events.event_id` PRIMARY KEY.

---

## Quick orientation — files most edits touch

| You're working on… | Start here | Tests |
|---|---|---|
| Receiver / signature / envelope | `src/app/api/webhooks/callsofia/route.ts`, `src/lib/webhook/{verify,envelope,types}.ts` | `src/lib/webhook/*.test.ts`, `src/app/api/webhooks/callsofia/route.test.ts` |
| Queue / consumer / retries | `src/app/api/queue/consumer/route.ts`, `src/lib/queue/{publisher,consumer}.ts`, `src/app/api/cron/process-retries/route.ts` | `src/lib/queue/consumer.test.ts`, `src/app/api/queue/consumer/route.test.ts` |
| Adapters (CRM integrations) | `src/lib/adapters/{registry,types}.ts` + per-adapter folder | `src/lib/adapters/*/<file>.test.ts` |
| Litify (Salesforce) | `src/lib/adapters/litify/{adapter,auth,person,intake,activity,recording,case-type-cache,field-mapping}.ts` | `src/lib/adapters/litify/*.test.ts` |
| Generic-webhook forwarder | `src/lib/adapters/generic-webhook/{adapter,transforms}.ts` | `src/lib/adapters/generic-webhook/*.test.ts` |
| DB / migrations | `src/lib/db/{schema,client}.ts`, `src/lib/db/migrations/`, `drizzle.config.ts` | `src/lib/db/schema.test.ts` |
| Mirror to platform-api activity_logs | `src/lib/platform-api/{client,activity-logs}.ts` | `src/lib/platform-api/client.test.ts` |
| Env / config | `src/lib/config.ts` (zod schema is the source of truth), `.env.example` | `src/lib/config.test.ts` |
| Admin UI / auth | `src/middleware.ts`, `src/app/admin/**/*.tsx`, `src/app/api/admin/**/route.ts` | (no tests yet) |
| Cron / health | `src/app/api/cron/{health-check,process-retries}/route.ts`, `vercel.json:crons` | (covered indirectly) |

`pnpm tsc --noEmit && pnpm vitest run` is the full local check. CI runs the same plus CodeQL + Vercel preview deploy.

---

## Conventions to follow

### Code

- **TypeScript strict.** No `any` unless wrapping a foreign API. Prefer `unknown` + zod parse at the boundary.
- **Lazy module-level state.** Never construct DB pools or external SDK clients at import time — Vercel cold-starts inject env vars after import in some paths. See `src/lib/db/client.ts` (Proxy + lazy `getDb`) and `src/lib/adapters/litify/auth.ts` (lazy connection).
- **Adapters are functions of the event.** Same input → same outcome. Side effects (HTTP, SF writes) MUST be safe to retry — the queue can re-deliver the same event multiple times. Use upsert-by-external-id patterns (e.g., `findByCallId` before `create`).
- **Outcome enum.** Adapter's `handle()` returns `{outcome: "success" | "noop" | "retry" | "failure", crm_record_id?, error?}`. `retry` = transient (network, 5xx, throttle). `failure` = validation / permanent (bad data, schema mismatch). The retry sweep only re-attempts `retry` outcomes.
- **Logger.** Use `src/lib/logger.ts` — structured JSON to stdout. Never `console.log` in production paths.
- **Tests use vitest.** Mock external deps via `vi.mock()`. The Litify adapter tests mock `litifyAuth.getConnection` AND `litifyAuth.withFreshConnection` together — see `src/lib/adapters/litify/person.test.ts` for the pattern.

### Database

- Drizzle schema in `src/lib/db/schema.ts` is the source of truth. Never write raw `CREATE TABLE` migrations by hand.
- Generate migrations with `pnpm db:generate` after schema edits. Commit the SQL file AND the snapshot AND the journal (`src/lib/db/migrations/meta/_journal.json` is tracked — required by `drizzle-kit migrate` at Vercel build time).
- `pnpm db:migrate` runs at build time per `vercel.json:buildCommand`. Idempotent — drizzle tracks applied migrations in `__drizzle_migrations`.
- Idempotency invariant: any new event-handling code path MUST tolerate `events.event_id` already existing. Use `ON CONFLICT DO NOTHING RETURNING` not `INSERT` + try/catch.

### HTTP

- All API routes use `runtime: "nodejs"` + `dynamic: "force-dynamic"` (Next.js App Router). Bridge does NOT use Edge runtime — it needs `postgres-js`, `jsforce`, etc.
- Webhooks return JSON only. Never raw text.
- Inbound HMAC: `sha256(secret, timestamp + "." + raw_body)`. Header is `X-CallSofia-Signature: sha256=<hex>`. Timestamp accepts UNIX seconds OR ISO 8601 (see `src/lib/webhook/verify.ts:isTimestampFresh`).
- Outbound to generic webhooks: same HMAC scheme, header `X-CallSofia-Bridge-Signature`.

### Env vars

- Source of truth: `src/lib/config.ts` (zod schema). `.env.example` MUST stay in sync.
- Required to start: `CALLSOFIA_API_BASE_URL`, `CALLSOFIA_ORG_ID`, `CALLSOFIA_API_KEY`, `CALLSOFIA_WEBHOOK_SECRET`, `DATABASE_URL`, `ADMIN_PASSWORD`. Everything else has a default or is conditional.
- `CRM_ADAPTER=none` is the safe first-deploy default — events land in DB but no downstream side effects. Switch to `litify` or `generic-webhook` once ready.
- `NEXT_PUBLIC_BASE_URL` MUST be set when Vercel Queues is unset (the in-process consumer fallback uses it; otherwise it tries `http://localhost:3000` which is dead on Vercel).

### Git

- Branch off `main`. PR back to `main`. Rebase, squash-merge.
- Commits in imperative mood, body explains the WHY.
- The drizzle journal (`src/lib/db/migrations/meta/_journal.json`) is committed — never gitignore it. (We learned this the hard way; see git history for `fix: track drizzle _journal.json`.)
- The `.vercel/` dir is gitignored.

---

## Known gotchas (pay attention)

1. **Salesforce custom-object field names.** `litify_pm__Person__c` is a Litify *custom object* (`__c` suffix). Standard Salesforce fields like `Phone` do NOT exist on it by default — Litify uses `litify_pm__Phone__c`. The current `src/lib/adapters/litify/person.ts` references bare `Phone`; this is documented as a TODO and needs to be reconciled against your Litify org's actual field schema before any prod customer onboarding. Tests mock `findOne` so they don't catch this.

2. **`withFreshConnection` not optional for data writes.** The `LitifyAuth` class has both `getConnection()` (cached, may return a stale-but-soft-TTL-valid connection) and `withFreshConnection(fn)` (auto-refreshes on `INVALID_SESSION_ID`/401 and retries once). Every data-write call MUST go through `withFreshConnection` — bare `getConnection` calls will dead-letter on session expiry. See `src/lib/adapters/litify/{person,intake,activity,recording}.ts` for the pattern.

3. **Platform-api envelope is FLAT.** Despite the spec describing `data: {scope, payload}`, the actual platform-api `_build_webhook_body` (`apps/platform-api/src/services/webhook_delivery.py:913` in the upstream repo) emits a flat `data: {...trimmed call fields...}`. Bridge accepts both via zod union and normalises to the nested shape internally. Don't "fix" the union to be strict.

4. **Platform-api activity_logs `source` allowlist.** `chk_activity_logs_source` is a CHECK constraint with a closed list (`webhook`, `voice_agent`, `post_call_dispatcher`, …). The bridge sends `source="webhook"` and stashes its identity in `metadata.source_app="callsofia-bridge"`. If you change the source default, verify it's in the allowlist or rows will be silently dropped server-side.

5. **Vercel Queues is optional.** When `VERCEL_QUEUE_PUBLISH_URL` is unset, `publishEventForProcessing` falls back to direct `fetch` against `${NEXT_PUBLIC_BASE_URL}/api/queue/consumer`. Make sure `NEXT_PUBLIC_BASE_URL` matches your deployment origin (e.g., `https://callsofia-bridge.vercel.app`).

6. **Postgres pool size = 3.** Hard-coded for Neon's pgBouncer transaction-mode budget per Function instance. If you swap to direct Postgres (no pooler), you can raise it — but be aware Fluid Compute reuses instances across concurrent invocations.

7. **`CRM_ADAPTER=none` returns `noop` outcomes.** Useful for first-deploy validation: events land in `events` table, the consumer fires, deliveries rows show `handler=none status=noop`. Bridge is fully exercised end-to-end without touching any CRM.

8. **Recording mode = `url` by default.** `LITIFY_RECORDING_MODE=url` writes the S3 presigned URL into `CallSofia_Recording_URL__c` on the Intake. The legacy `attach` mode base64-loads the OGG file and uploads as `ContentVersion` — risks OOM on Vercel Functions for files > ~30 MB. Only opt into `attach` when you need self-contained Salesforce storage and your recordings are small.

---

## Common tasks (copy-paste recipes)

### "Add a new CRM adapter"

1. Create `src/lib/adapters/<name>/{adapter,types}.ts` and any helpers.
2. Implement the `CrmAdapter` interface (see `src/lib/adapters/types.ts`):
   ```ts
   export interface CrmAdapter {
     readonly name: string;
     handle(event: CallSofiaEvent, ctx: AdapterCtx): Promise<AdapterResult>;
     healthCheck(): Promise<{ healthy: boolean; message?: string }>;
   }
   ```
3. Register in `src/lib/adapters/registry.ts` — add to `selectAdapterName` (env → name) and `getAdapter` (name → instance).
4. Add tests: cover `success`, `retry`-on-transient, `failure`-on-validation, and idempotency (handle the same event twice).
5. Document env vars in `src/lib/config.ts` zod schema + `.env.example` + `docs/integrations/<name>.md`.
6. Run `pnpm tsc --noEmit && pnpm vitest run`.

See `docs/integrations/custom-adapter.md` for a worked example.

### "Add support for a new event type"

1. Add the string literal to `EVENT_TYPES` in `src/lib/webhook/types.ts`.
2. Add a config toggle in `src/lib/config.ts` (`HANDLE_<EVENT>` env var, default `true` or `false` based on your default behavior).
3. If the consumer should treat it specially, add a branch in `src/app/api/queue/consumer/route.ts:handlerToggle`.
4. If adapters need to handle it, add cases in each adapter's `handle()` switch.
5. Tests + docs.

### "Add a Postgres column"

1. Edit `src/lib/db/schema.ts`.
2. `pnpm db:generate` — produces a new SQL migration file under `src/lib/db/migrations/`.
3. Inspect the SQL — make sure it's safe (`ALTER TABLE ... ADD COLUMN` is fine; `DROP COLUMN` needs a backwards-compat plan).
4. Commit the migration file + updated `meta/0000_snapshot.json` + `meta/_journal.json`.
5. Vercel runs `pnpm db:migrate` on next deploy.

### "Debug why a webhook returned 4xx"

1. Hit the bridge's admin dashboard at `/admin` (Basic Auth, `ADMIN_PASSWORD`).
2. Click into the failing event → see request/response body.
3. Check `webhook_deliveries.response_body` in your sender (e.g., platform-api). Common errors:
   - `{"error":"Invalid signature"}` → secret mismatch
   - `{"error":"Timestamp too old"}` → clock skew or wrong timestamp format (must be unix-sec or ISO 8601)
   - `{"error":"Invalid envelope"}` → zod parse failure; check the body shape against `src/lib/webhook/envelope.ts:EnvelopeSchema`
4. See `docs/troubleshooting.md` for the full triage table.

### "Rotate the webhook secret"

Today: brief downtime. Set new `CALLSOFIA_WEBHOOK_SECRET` env on bridge → redeploy → update sender's secret. Improvement candidate: support BOTH old + new for a window (not implemented yet).

### "Run locally against a real Postgres"

```bash
git clone https://github.com/call-sofia/callsofia-bridge.git
cd callsofia-bridge
pnpm install
cp .env.example .env.local
# Edit .env.local — set DATABASE_URL to your local/Neon Postgres
pnpm db:migrate
pnpm dev
# Bridge is now at http://localhost:3000
# Hit http://localhost:3000/api/cron/health-check to confirm
```

### "Send a test webhook to a running bridge"

```bash
node scripts/dev/send-test-webhook.mjs --url http://localhost:3000
# or, hand-crafted:
SECRET=$(grep CALLSOFIA_WEBHOOK_SECRET .env.local | cut -d= -f2)
TS=$(date +%s)
BODY='{"event_id":"00000000-0000-0000-0000-deadbeef0001","event_type":"call.ended","emitted_at":"'$(date -u +%Y-%m-%dT%H:%M:%SZ)'","schema_version":1,"data":{"call_id":"test","extracted_vars":{}}}'
SIG=$(echo -n "${TS}.${BODY}" | openssl dgst -sha256 -hmac "$SECRET" -hex | awk '{print $2}')
curl -X POST http://localhost:3000/api/webhooks/callsofia \
  -H "Content-Type: application/json" \
  -H "X-CallSofia-Timestamp: $TS" \
  -H "X-CallSofia-Signature: sha256=$SIG" \
  -d "$BODY"
```

---

## Testing strategy

- **Unit:** vitest, fast, mocked external deps. Every adapter must have a unit test that covers the 4 outcomes (`success`, `noop`, `retry`, `failure`).
- **Route:** vitest, exercises the full Next.js handler with mocked DB + queue + adapter.
- **No integration tests (today):** bridge has been validated end-to-end manually by sending real platform-api webhooks. A future improvement is a Docker-Compose setup with mock Salesforce + Postgres for local integration testing.
- **CI:** GitHub Actions runs `pnpm test` (= `vitest run`) on every push. CodeQL also runs. Vercel preview deploy runs the build (which includes `pnpm db:migrate` against the deploy's `DATABASE_URL`).

---

## When asked to make changes

1. **Read this file first** if you haven't.
2. Read the relevant files in the "Quick orientation" table above.
3. Run `pnpm tsc --noEmit && pnpm vitest run` BEFORE editing — establish a green baseline.
4. Edit + add/update tests.
5. Run again. Both must pass before you propose a commit.
6. If your change affects the public API surface (envelope shape, env vars, adapter contract), update `docs/` and `.env.example` in the same PR.
7. Use the commit message format documented in the existing git log (look at the most recent 5 commits).

---

## Architecture decisions worth remembering

| Decision | Why | Where |
|---|---|---|
| Idempotency via events PK, not Redis | One less external service; events are durable anyway | `src/app/api/webhooks/callsofia/route.ts` (ON CONFLICT DO NOTHING RETURNING) |
| Lazy DB client via Proxy | Cold-start safety on Vercel | `src/lib/db/client.ts` |
| `withFreshConnection` for Salesforce | Soft-TTL caching + auto-refresh on session expiry | `src/lib/adapters/litify/auth.ts` |
| Queue is optional, in-process fallback exists | Lower barrier to deployment (no Vercel Queues required for first deploy) | `src/lib/queue/publisher.ts` |
| Recording defaults to URL mode | Avoid Vercel function OOM on large OGG files | `src/lib/adapters/litify/recording.ts` |
| Bridge-side activity_logs mirror | Operators see ALL bridge events in CallSofia's main dashboard, not just deliveries | `src/lib/platform-api/client.ts` (`logActivity`) |
| Pool max=3 | Neon pgBouncer per-instance budget | `src/lib/db/client.ts` |
| Drizzle journal in git | drizzle-kit needs it at build time | `src/lib/db/migrations/meta/_journal.json` |

---

## Where to find more

- `docs/getting-started.md` — 5-min quickstart from fork to first webhook
- `docs/configuration.md` — every env var explained
- `docs/architecture.md` — digestible architecture (this file's siblings get into the weeds)
- `docs/payload-spec.md` — exact incoming envelope contract
- `docs/integrations/litify.md` — Salesforce / Litify wiring
- `docs/integrations/generic-webhook.md` — forward to Make / Zapier / custom HTTP
- `docs/integrations/custom-adapter.md` — write your own
- `docs/security.md` — HMAC, idempotency, secret management, threat model
- `docs/deployment.md` — Vercel + alternatives
- `docs/troubleshooting.md` — symptom → fix table
- `docs/DESIGN.md` — full 49 KB original architecture spec (kept for historical reference)

---

## Status

The bridge is **production-ready** for the inbound receiver, ledger, queue consumer, retry sweep, generic-webhook adapter, admin UI, and the Litify adapter (with the Phone-field caveat called out above). It has been validated end-to-end against real CallSofia DEV traffic (HTTP 200, `events` row, `deliveries` row, mirror to `activity_logs`).

Open improvement areas (not blockers): per-customer field overrides, bilingual description templates, dual-secret rotation window, integration test harness, a per-deployment "incident replay" tool from the admin UI.

Contributions welcome — see `CONTRIBUTING.md` and `docs/integrations/custom-adapter.md`.
