# Getting Started

This guide takes you from a fresh fork to a healthy CallSofia Bridge deployment in about five minutes. The bridge receives signed webhooks from CallSofia, persists them to Postgres, and (optionally) forwards them to your CRM.

## Table of Contents

- [What you'll deploy](#what-youll-deploy)
- [Prerequisites](#prerequisites)
- [1. Click-to-deploy on Vercel](#1-click-to-deploy-on-vercel)
- [2. Create a Postgres database](#2-create-a-postgres-database)
- [3. Set the minimum required env vars](#3-set-the-minimum-required-env-vars)
- [4. Register the bridge URL on CallSofia](#4-register-the-bridge-url-on-callsofia)
- [5. Place a test call (or replay one)](#5-place-a-test-call-or-replay-one)
- [6. Verify everything is healthy](#6-verify-everything-is-healthy)
- [Local development](#local-development)
- [What's next](#whats-next)

## What you'll deploy

A single Next.js app on Vercel that:

- Exposes `POST /api/webhooks/callsofia` for signed webhook delivery
- Writes every event to the `events` table (Postgres)
- Forwards processed events to your CRM via a pluggable adapter (`litify`, `generic-webhook`, or `none`)
- Mirrors a copy of every event to CallSofia's `activity_logs` for cross-side observability
- Runs two Vercel Crons (`/api/cron/process-retries` every minute, `/api/cron/health-check` every 5 minutes)
- Ships a password-gated `/admin` UI for inspecting recent events

For the architectural overview see [`architecture.md`](./architecture.md).

## Prerequisites

- A [Vercel](https://vercel.com) account (Hobby tier is fine for evaluation)
- A Postgres database — a free [Neon](https://neon.tech) project takes ~30 seconds
- A CallSofia organisation with API access. You'll need:
  - `CALLSOFIA_ORG_ID` — your org UUID
  - `CALLSOFIA_API_KEY` — Stripe-style key (`sk_<env>_<org>_<random>`)
  - `CALLSOFIA_WEBHOOK_SECRET` — the HMAC secret you set when registering the webhook (`whsec_…`)

## 1. Click-to-deploy on Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/call-sofia/callsofia-bridge)

The button forks the repo into your GitHub account and creates a new Vercel project. The build command (`pnpm db:migrate && pnpm build` — see [`vercel.json`](../vercel.json)) runs Drizzle migrations against `DATABASE_URL` automatically, so the database schema is in place by the time the first deploy goes live.

Don't have GitHub set up? You can also clone manually and run `vercel deploy` — see [`deployment.md`](./deployment.md) for the CLI flow.

## 2. Create a Postgres database

The fastest path is the Vercel Marketplace:

1. In the Vercel dashboard, open your project → **Storage** → **Create Database** → **Neon Postgres**
2. Accept the defaults — Vercel injects `DATABASE_URL` (and a few `POSTGRES_*` aliases) automatically

Any Postgres works — Supabase Postgres, RDS, self-hosted, or a local container. The bridge reads `DATABASE_URL` and nothing else for storage. See [`configuration.md`](./configuration.md#storage) for connection-string formats.

## 3. Set the minimum required env vars

The bridge needs seven env vars to reach a healthy state. Set them via **Vercel → Project → Settings → Environment Variables**, or with the CLI:

```bash
vercel env add CALLSOFIA_API_BASE_URL    # https://api.callsofia.co
vercel env add CALLSOFIA_ORG_ID          # 10000000-0000-0000-0000-000000000001
vercel env add CALLSOFIA_API_KEY         # sk_prod_acmelaw_xxx
vercel env add CALLSOFIA_WEBHOOK_SECRET  # whsec_REPLACE_ME
vercel env add DATABASE_URL              # already set if you used Marketplace
vercel env add ADMIN_PASSWORD            # your choice — gates /admin
vercel env add CRM_ADAPTER               # set to: none
```

Setting `CRM_ADAPTER=none` is the recommended first run — events still land in the `events` table, but no downstream CRM call is attempted. Once you've confirmed events are flowing, switch to `litify` or `generic-webhook` and add the adapter-specific env vars from [`configuration.md`](./configuration.md).

> **Note:** If you don't enable Vercel Queues, also set `NEXT_PUBLIC_BASE_URL` to your deploy URL (e.g. `https://your-bridge.vercel.app`). The in-process consumer fallback uses it to invoke itself. See [`configuration.md`](./configuration.md#vercel-specific) for details.

After saving env vars, redeploy: `vercel --prod` (or push a commit).

## 4. Register the bridge URL on CallSofia

In the CallSofia dashboard, register a webhook subscription pointing at:

```
https://your-bridge.vercel.app/api/webhooks/callsofia
```

Use the same `whsec_…` secret you put in `CALLSOFIA_WEBHOOK_SECRET`. Subscribe to the events you care about — see the catalogue in [`payload-spec.md`](./payload-spec.md#event-types).

## 5. Place a test call (or replay one)

The most natural smoke test is to dial your CallSofia number and hang up — the bridge should receive `call.ringing`, `call.ended`, and (after extraction) `call.extracted`.

If you'd rather not place a real call, send a synthetic webhook with curl. Generate the signature exactly the same way platform-api does (`HMAC-SHA256(secret, "{timestamp}.{body}")`):

```bash
SECRET="whsec_REPLACE_ME"
TS=$(date +%s)
# Generate a fresh event_id per invocation. uuidgen ships on macOS / most Linux
# distros; if it's missing, fall back to Python:
EVENT_ID=$(uuidgen 2>/dev/null || python3 -c 'import uuid; print(uuid.uuid4())')
BODY="{\"event_id\":\"$EVENT_ID\",\"event_type\":\"call.ringing\",\"emitted_at\":\"2026-04-30T18:00:00Z\",\"schema_version\":1,\"data\":{\"call_id\":\"test\"}}"
SIG="sha256=$(printf '%s.%s' "$TS" "$BODY" | openssl dgst -sha256 -hmac "$SECRET" -hex | awk '{print $2}')"

curl -X POST https://your-bridge.vercel.app/api/webhooks/callsofia \
  -H "content-type: application/json" \
  -H "x-callsofia-event: call.ringing" \
  -H "x-callsofia-delivery: $(uuidgen)" \
  -H "x-callsofia-timestamp: $TS" \
  -H "x-callsofia-signature: $SIG" \
  --data "$BODY"
```

Expected response: `{"ok":true}`. Re-running the curl with the same `event_id` returns `200 {"ok":true,"duplicate":true}` — that's the bridge's idempotency guard, not a failure. See [`payload-spec.md`](./payload-spec.md#response-contract) for the full response contract.

## 6. Verify everything is healthy

Three checks:

1. **Health endpoint** — `GET https://your-bridge.vercel.app/api/cron/health-check` returns `{"healthy":true,"checks":{"postgres":{"healthy":true},"adapter":{"healthy":true}}}`. Implementation: [`src/app/api/cron/health-check/route.ts`](../src/app/api/cron/health-check/route.ts).
2. **Admin UI** — visit `https://your-bridge.vercel.app/admin`, authenticate with `ADMIN_PASSWORD`, and confirm the test event appears under "Recent Events".
3. **CallSofia activity_logs** — the bridge mirrors every received event to platform-api `/v1/logs` with `event_type=bridge.event_received`. Search there to confirm cross-side delivery.

If any of these fail, see [`troubleshooting.md`](./troubleshooting.md).

## Local development

```bash
pnpm install
cp .env.example .env.local        # then fill in values
pnpm db:migrate                    # apply schema to your local Postgres
pnpm dev                           # http://localhost:3000
```

The cheapest local Postgres is a free Neon project — copy its `DATABASE_URL` into `.env.local`. A local container also works: `docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=dev postgres:16`.

To replay canned webhook payloads against your dev server, use the included mock sender:

```bash
pnpm tsx scripts/dev/mock-callsofia.ts http://localhost:3000/api/webhooks/callsofia
```

> **Prerequisite:** the script does not bundle its own fixtures. By default it looks for them in `../callsofia-webhooks-docs/examples/payloads` (i.e. a sibling `callsofia-webhooks-docs` repo cloned next to this one). If you don't have that repo, pass `--fixtures-dir=<path>` pointing at any directory that contains the per-event JSON files (`call.ringing.json`, `call.answered.json`, etc.).

The script ([`scripts/dev/mock-callsofia.ts`](../scripts/dev/mock-callsofia.ts)) signs each fixture with `CALLSOFIA_WEBHOOK_SECRET` (defaults to `whsec_dev`) and walks through `call.ringing → call.answered → call.in_progress → call.ended → call.extracted → lead.qualified → evaluation.complete`.

To run the test suite:

```bash
pnpm test           # one-shot
pnpm test:watch     # watch mode
pnpm typecheck      # strict tsc
```

## What's next

- [`configuration.md`](./configuration.md) — every env var, what it does, when to set it
- [`architecture.md`](./architecture.md) — one-page tour of the receive → queue → consume → adapter pipeline
- [`payload-spec.md`](./payload-spec.md) — envelope shape, headers, event catalogue, `extracted_vars` field reference
- [`deployment.md`](./deployment.md) — production checklist, custom domains, rollback, self-hosting
- [`troubleshooting.md`](./troubleshooting.md) — common errors and how to fix them
- [`integrations/litify.md`](./integrations/litify.md) — wiring the bridge to Litify (Salesforce)
- [`security.md`](./security.md) — HMAC details, replay-protection window, recommended secret rotation
