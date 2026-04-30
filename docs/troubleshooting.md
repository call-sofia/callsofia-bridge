# Troubleshooting

Symptom-driven guide to the failures we've actually seen in production. Each entry: what you observe, why it happens, how to fix it. For the architectural context behind any of these, see [`architecture.md`](./architecture.md).

## Table of Contents

- [Deploy & build](#deploy--build)
- [Webhook receive errors](#webhook-receive-errors)
- [Admin & auth](#admin--auth)
- [Database connection](#database-connection)
- [Adapter & downstream errors](#adapter--downstream-errors)
- [Queueing & retries](#queueing--retries)
- [Observability gaps](#observability-gaps)
- [Quick diagnostic recipes](#quick-diagnostic-recipes)

## Deploy & build

### First Vercel deploy fails with "no migration files found"

**Cause:** the Drizzle journal `src/lib/db/migrations/meta/_journal.json` was not committed.

**Fix:** ensure the journal is checked in. This file is what `pnpm db:migrate` uses to track applied migrations — without it, the runner refuses to proceed.

```bash
ls src/lib/db/migrations/meta/_journal.json     # must exist
git add src/lib/db/migrations
git commit -m "fix: include drizzle journal"
```

(This was an early bug in the project's history. Listed for posterity in case you regenerate migrations and forget to stage the journal.)

### Build fails with `DATABASE_URL` undefined

**Cause:** `pnpm db:migrate` runs as part of the build and needs `DATABASE_URL` at build time.

**Fix:** set `DATABASE_URL` in Vercel for the **Production** and **Preview** environments. If you only set it for Production, preview deploys will fail.

## Webhook receive errors

### Bridge returns 400 "Invalid envelope"

**Cause:** the body fails Zod validation. Most often this is sender-side spec drift — a field renamed, a UUID malformed, or `event_type` not in the allowed list.

**Fix:** the bridge accepts both nested (`data:{scope,payload}`) and flat (`data:{...fields}`) shapes — see [`payload-spec.md`](./payload-spec.md#two-accepted-shapes). If your sender is older than the platform-api dispatcher, the field set may have shifted. Compare your payload against [`src/lib/webhook/envelope.ts`](../src/lib/webhook/envelope.ts).

```bash
# Replay the offending body locally and read the Zod error
curl -X POST http://localhost:3000/api/webhooks/callsofia \
  -H 'content-type: application/json' \
  -H "x-callsofia-timestamp: $(date +%s)" \
  -H "x-callsofia-signature: sha256=…" \
  --data @offending-body.json
```

### Bridge returns 400 "Timestamp too old"

**Cause:** clock skew, or the timestamp format isn't recognised. The receiver allows ±300 seconds and accepts UNIX seconds (10 digits), UNIX milliseconds (13 digits), or ISO 8601 — see [`src/lib/webhook/verify.ts`](../src/lib/webhook/verify.ts).

**Fix:** check NTP on the sender. If the sender is sending fractional UNIX seconds (e.g. `1714501234.123`), strip the fractional part first.

### Bridge returns 401 "Invalid signature"

**Cause:** `CALLSOFIA_WEBHOOK_SECRET` mismatch between sender and bridge, or a proxy is re-encoding the body between them.

**Fix:**

1. Re-copy the secret from the CallSofia dashboard. Watch for trailing whitespace and accidental newlines.
2. Confirm any reverse proxy preserves the request body byte-for-byte. Cloudflare's "automatic minification" or any framework that re-serialises JSON will break the HMAC.
3. The signing scheme is `HMAC-SHA256(secret, "{timestamp}.{rawBody}")` — match exactly. See [`architecture.md`](./architecture.md#hmac-scheme).

```bash
# Sign and send a test request locally
SECRET="whsec_…"; TS=$(date +%s); BODY='{"event_id":"…","event_type":"call.ringing","emitted_at":"…","schema_version":1,"data":{}}'
SIG="sha256=$(printf '%s.%s' "$TS" "$BODY" | openssl dgst -sha256 -hmac "$SECRET" -hex | awk '{print $2}')"
curl -i -X POST https://your-bridge.vercel.app/api/webhooks/callsofia \
  -H "x-callsofia-timestamp: $TS" -H "x-callsofia-signature: $SIG" \
  -H "content-type: application/json" --data "$BODY"
```

### Webhook reaches bridge but no `events` row

**Cause:** the receiver did `INSERT … ON CONFLICT DO NOTHING` and the row already existed. This is the idempotency happy path; the response is `{"ok":true,"duplicate":true}`.

**Fix:** nothing to fix — this means the same `event_id` was delivered before. Check the response body to confirm `duplicate:true`. If the response was `{"ok":true}` (no duplicate flag) and yet you see no row, your DB connection is going somewhere else than you think (different schema? read replica?). Run:

```bash
psql "$DATABASE_URL" -c "SELECT event_id, event_type, received_at FROM events ORDER BY received_at DESC LIMIT 5;"
```

## Admin & auth

### `/admin` returns 500 "Server misconfigured"

**Cause:** `ADMIN_PASSWORD` env var not set. The middleware throws on boot.

**Fix:** set `ADMIN_PASSWORD` in Vercel env vars and redeploy. The minimum length is 8 characters.

### `/admin` keeps re-prompting for credentials

**Cause:** browser cached an old basic-auth credential pair after a password change.

**Fix:** open in incognito, or send a logout request to clear the credential cache:

```bash
curl -u admin:wrong https://your-bridge.vercel.app/admin   # forces re-auth
```

## Database connection

### Postgres "Tenant or user not found" (Supabase)

**Cause:** wrong pooler hostname. Supabase rotates pooler subdomains by region — `aws-0-us-east-1` vs `aws-1-us-east-1`. Connection-string snippets copied from old docs may point at the wrong one.

**Fix:** in the Supabase dashboard go to **Project Settings → Database → Connection string → Transaction (pooler)** and copy the current value. Confirm the host prefix matches:

```bash
psql "$DATABASE_URL" -c "SELECT current_user, inet_server_addr();"
```

### Connection pool exhausted under burst load

**Cause:** Vercel Functions burst-spawn under load and each instance opens its own pool.

**Fix:** use a pooled connection string (Neon's `-pooler` endpoint, Supabase's `?pgbouncer=true`). Tune the pool max in the URL: `?pool_max=10`. See [`deployment.md`](./deployment.md#database-options).

## Adapter & downstream errors

### Adapter returns `INVALID_SESSION_ID` after long idle (Salesforce / Litify)

**Cause:** Salesforce session policy is shorter than the bridge's soft-TTL on the cached connection. The first request after a long idle period hits a stale session.

**Fix:** ensure the Litify adapter wraps every operation in `litifyAuth.withFreshConnection(fn)` — the helper detects 401 / `INVALID_SESSION_ID`, refreshes via OAuth, and retries once. If you see this error anyway, you have a code path bypassing the wrapper. Search the Litify adapter for direct `connection.query()` / `connection.sobject()` calls and route them through the helper.

### Adapter health check unhealthy at startup

**Cause:** missing or invalid Salesforce credentials, or the Connected App is misconfigured.

**Fix:**

1. Verify `SALESFORCE_LOGIN_URL`, `SALESFORCE_CLIENT_ID`, `SALESFORCE_CLIENT_SECRET` are all set
2. In the Salesforce Connected App, confirm **Enable Client Credentials Flow** is on and a run-as user is configured
3. Hit the health endpoint and read the message:

```bash
curl https://your-bridge.vercel.app/api/cron/health-check | jq .
```

See [`integrations/litify.md`](./integrations/litify.md) for the full Salesforce setup.

## Queueing & retries

### Queue consumer never fires

**Cause (most common):** `NEXT_PUBLIC_BASE_URL` is unset and the in-process consumer fallback is hitting `http://localhost:3000` — which doesn't exist on Vercel.

**Fix:** set `NEXT_PUBLIC_BASE_URL` to your deploy URL (e.g. `https://your-bridge.vercel.app`). Redeploy. See [`configuration.md`](./configuration.md#vercel-specific).

**Cause (alternative):** Vercel Queues is enabled but `QUEUE_TOKEN` doesn't match what the queue subscription expects.

**Fix:** verify the bearer token in the Vercel Queues dashboard matches `QUEUE_TOKEN`. Check the publish endpoint's logs for 401s.

### Events stuck in `retrying` status

**Diagnosis:** check the `deliveries` table for the actual error.

```bash
psql "$DATABASE_URL" -c "
SELECT event_id, handler_id, attempt, error_code, error_message, completed_at
FROM deliveries
WHERE status = 'retrying'
ORDER BY completed_at DESC
LIMIT 20;"
```

For Salesforce 401s: the next retry refreshes the token and usually succeeds. For Salesforce 429s: wait for the rate-limit window. After `MAX_RETRIES` attempts, the event dead-letters and a `bridge.dead_letter` activity log fires. Replay manually via `/admin/replay`.

### High latency between platform-api dispatch and `events` row

**Cause:** SQS race upstream. If your bridge shares a queue with PROD platform-api traffic (which can happen on shared DEV environments), there can be queueing delays.

**Fix:** request a dedicated DEV queue from the platform team — there's a known follow-up tracked for this. In the meantime, the bridge itself is not the bottleneck; the receiver runs in <500 ms once the request lands.

## Observability gaps

### All `/v1/logs` mirror entries silently dropped

**Cause:** platform-api enforces a `chk_activity_logs_source` CHECK constraint with an explicit allowlist (`webhook`, `webhook_delivery`, `voice_agent`, etc.). Anything outside the list is silently rejected by the batch writer.

**Fix:** the bridge defaults `source="webhook"` (see [`src/lib/platform-api/activity-logs.ts`](../src/lib/platform-api/activity-logs.ts)). Don't override it to a custom value. To distinguish bridge-emitted rows downstream, use `metadata.source_app="callsofia-bridge"` — already set automatically.

### Mirror logs missing entirely

**Cause:** `MIRROR_TO_PLATFORM_API` is `false`, or `CALLSOFIA_API_KEY` is invalid.

**Fix:**

```bash
# Confirm mirroring is enabled
vercel env ls | grep MIRROR

# Smoke test the API key
curl -i -H "X-API-Key: $CALLSOFIA_API_KEY" $CALLSOFIA_API_BASE_URL/v1/health
```

## Quick diagnostic recipes

```bash
# 1. Is the bridge alive?
curl -s https://your-bridge.vercel.app/api/cron/health-check | jq .

# 2. Most recent events
psql "$DATABASE_URL" -c "
SELECT event_type, status, received_at
FROM events
ORDER BY received_at DESC
LIMIT 20;"

# 3. Most recent failures
psql "$DATABASE_URL" -c "
SELECT event_id, handler_id, attempt, status, error_code, error_message
FROM deliveries
WHERE status IN ('failed', 'retrying')
ORDER BY completed_at DESC
LIMIT 20;"

# 4. Pending retries
psql "$DATABASE_URL" -c "
SELECT event_id, handler_id, scheduled_for, attempt
FROM retry_queue
ORDER BY scheduled_for
LIMIT 20;"

# 5. Tail Vercel logs for the receiver
vercel logs --follow https://your-bridge.vercel.app
```

If you've worked through everything here and the issue persists, open a GitHub issue with: the offending `event_id`, the response status, the `deliveries.error_message` (if any), and the relevant excerpt from `vercel logs`.
