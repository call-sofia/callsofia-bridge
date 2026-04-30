# CallSofia Bridge

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fcall-sofia%2Fcallsofia-bridge&env=DATABASE_URL,CALLSOFIA_API_BASE_URL,CALLSOFIA_ORG_ID,CALLSOFIA_API_KEY,CALLSOFIA_WEBHOOK_SECRET,ADMIN_PASSWORD,CRM_ADAPTER&envDescription=Minimum%20env%20vars%20to%20boot%20the%20bridge.%20See%20docs%2Fconfiguration.md%20for%20the%20full%20list.&envLink=https%3A%2F%2Fgithub.com%2Fcall-sofia%2Fcallsofia-bridge%2Fblob%2Fmain%2Fdocs%2Fconfiguration.md&project-name=callsofia-bridge&repository-name=callsofia-bridge)

**Webhook middleware that turns [CallSofia](https://callsofia.co) AI voice intake events into CRM records.** Default integration is [Litify](https://www.litify.com) on Salesforce; pluggable via a small `CrmAdapter` interface for HubSpot, Filevine, MyCase, Make.com, Zapier, n8n, or any custom destination.

```
CallSofia voice agent → Bridge (this repo) → your CRM
```

Each customer gets their own Vercel deployment from this codebase. Configuration is entirely env-var driven — no per-customer code changes.

---

## Why this exists

CallSofia's voice agent collects structured intake data during the call (caller details, incident facts, injuries, insurance, evidence) and POSTs an event for each call lifecycle moment to a configured webhook URL. Without a bridge you'd have to:

- verify HMAC signatures correctly
- handle idempotency (duplicate deliveries are normal)
- map CallSofia's flat event payload into your CRM's object graph
- handle authentication, retries, and dead-letter for the downstream CRM

This repo does all of that, stateless except for a Postgres ledger, in ~3000 lines of TypeScript.

---

## What you get

| | |
|---|---|
| **Inbound receiver** | HMAC-SHA256 signature verify, 300s timestamp freshness, zod-validated envelope. Accepts both spec-shape and platform-api flat-data shape. Returns `200 {ok:true}` happy path, `200 {ok:true,duplicate:true}` for idempotency hits, structured errors otherwise. |
| **Postgres ledger** | Every event stored once (PK on `event_id`). Full envelope, signature validity, status tracked. Drizzle ORM with auto-migrations on deploy. |
| **Queue + retry sweep** | Vercel Queues (optional) with in-process fetch fallback. Exponential backoff, atomic retry-claim via `SELECT ... FOR UPDATE SKIP LOCKED`. Cron-driven retry sweep. |
| **Adapters** | Litify (Salesforce OAuth Client Credentials, parameterized SOQL, auto session refresh on 401), generic-webhook forwarder (raw / flat / litify-shape transforms, HMAC-signed), and a `none` adapter for first-deploy validation. Add your own in ~200 lines. |
| **Admin UI** | Password-protected dashboard at `/admin` — recent events, replay, failures, health, per-event detail with full envelope. Basic Auth, timing-safe compare. |
| **Observability** | Health-check cron every 5 min hitting Postgres + adapter + activity-log mirror. Activity-log mirror to CallSofia's `/v1/logs` for end-to-end visibility. Structured JSON logs to stdout. |
| **CI** | GitHub Actions: extensive vitest suite, tsc strict, CodeQL. Vercel preview deploy on every PR. |

---

## 60-second quickstart

1. **Click the Deploy button** at the top of this README. Vercel will fork the repo into your account, prompt for the 7 minimum env vars, and provision a deployment.

2. **Provision a Postgres** (Vercel Marketplace → Neon Postgres is fastest; Supabase / RDS / self-hosted all work). Set `DATABASE_URL` to the connection string.

3. **Get a CallSofia API key** for your org. Set:
   - `CALLSOFIA_API_BASE_URL=https://api.callsofia.co` (or `https://dev.api.callsofia.co` for sandbox)
   - `CALLSOFIA_ORG_ID=<your org UUID>`
   - `CALLSOFIA_API_KEY=sk_prod_...`

4. **Generate a webhook secret** (`openssl rand -hex 16` → prefix with `whsec_`). Set on BOTH sides:
   - `CALLSOFIA_WEBHOOK_SECRET=whsec_...` on the bridge
   - Same value in the `secret` field when registering the bridge URL on CallSofia

5. **Set `ADMIN_PASSWORD`** to a strong random string. This protects `/admin`.

6. **Set `CRM_ADAPTER=none`** for the first deploy. This validates the full pipeline end-to-end without touching any downstream CRM.

7. **Hit the health check.** `curl https://<your-deploy>.vercel.app/api/cron/health-check` should return `{"healthy":true,...}`.

8. **Register the bridge URL on CallSofia.** In `voice_agent_configs.runtime_config.webhooks` (or via the CallSofia dashboard's webhooks UI), add:
   ```json
   {
     "name": "callsofia-bridge",
     "url": "https://<your-deploy>.vercel.app/api/webhooks/callsofia",
     "secret": "whsec_...",
     "active": true,
     "events": ["call.ended", "call.extracted", "evaluation.complete", "recording.ogg"]
   }
   ```

9. **Place a test call.** Watch `/admin` — you should see the event row populate within a few seconds.

10. **Switch `CRM_ADAPTER` to `litify` or `generic-webhook`** when you're ready to actually push to a CRM. See [`docs/integrations/`](docs/integrations/).

Detailed walkthrough: [`docs/getting-started.md`](docs/getting-started.md).

---

## Architecture in one paragraph

The receiver verifies the signature, parses the envelope, inserts into `events` with `ON CONFLICT DO NOTHING RETURNING event_id` (the entire idempotency mechanism — no Redis, no KV store), mirrors a summary to CallSofia's `/v1/logs`, and publishes to the queue. The queue consumer loads the event, resolves the configured adapter (`litify` | `generic-webhook` | `none`), runs `adapter.handle(event)`, and writes the outcome to `deliveries`. Failed `retry` outcomes get re-attempted by the cron-driven retry sweep with exponential backoff until `MAX_RETRIES` (default 10) or dead-letter. There is no in-memory state and no LLM dependency — every decision is deterministic.

Full diagram and component table: [`docs/architecture.md`](docs/architecture.md).

---

## Documentation

| Doc | Read when… |
|---|---|
| [`docs/getting-started.md`](docs/getting-started.md) | First time setting up |
| [`docs/configuration.md`](docs/configuration.md) | You need to tweak env vars |
| [`docs/architecture.md`](docs/architecture.md) | You want to understand how it works |
| [`docs/payload-spec.md`](docs/payload-spec.md) | You're writing an adapter or debugging an envelope error |
| [`docs/integrations/litify.md`](docs/integrations/litify.md) | You're wiring the Salesforce / Litify adapter |
| [`docs/integrations/generic-webhook.md`](docs/integrations/generic-webhook.md) | You want to forward to Make.com, Zapier, n8n, or custom HTTP |
| [`docs/integrations/custom-adapter.md`](docs/integrations/custom-adapter.md) | You're writing a new CRM adapter |
| [`docs/security.md`](docs/security.md) | Hardening, secret rotation, threat model |
| [`docs/deployment.md`](docs/deployment.md) | Vercel + alternatives, crons, scaling |
| [`docs/troubleshooting.md`](docs/troubleshooting.md) | Symptom → diagnosis → fix table |
| [`CLAUDE.md`](CLAUDE.md) | Working with Claude Code (or any LLM pair-programmer) on this repo |

For the original 49KB architecture spec, see [`docs/DESIGN.md`](docs/DESIGN.md). The `docs/getting-started.md` and `docs/architecture.md` are the digestible versions; `DESIGN.md` is the deep reference kept for historical context.

---

## Local development

```bash
git clone https://github.com/call-sofia/callsofia-bridge.git
cd callsofia-bridge
pnpm install
cp .env.example .env.local
# Edit .env.local — minimum: DATABASE_URL (a Neon free DB or local Postgres works)
pnpm db:migrate
pnpm dev
# → http://localhost:3000
```

Useful commands:

```bash
pnpm test               # vitest run
pnpm tsc --noEmit       # strict type check
pnpm lint               # next lint
pnpm db:generate        # generate a new migration after editing src/lib/db/schema.ts
pnpm db:migrate         # apply pending migrations
pnpm db:push            # push schema directly without a migration (dev only!)
```

---

## Working with Claude Code on this repo

We've put significant effort into making the repo legible to LLM-based pair-programmers. The single highest-leverage file is [`CLAUDE.md`](CLAUDE.md) — load it into your Claude/Cursor/Aider session before asking questions. It covers the pipeline, file map, conventions, gotchas, common-task recipes, and architecture decisions, optimised for one-shot context loading.

If you're forking and want to adapt the bridge for a different CRM, the typical Claude session is:

1. Fork the repo locally
2. Open it in Claude Code (`claude code .`)
3. "Read CLAUDE.md and tell me how to add an adapter for [my CRM]"
4. Claude will scaffold, point at the right examples, and walk you through `CrmAdapter` implementation

---

## Contributing

PRs welcome. Please:

- Run `pnpm tsc --noEmit && pnpm vitest run` before pushing
- Update `docs/` and `.env.example` if your change affects the public surface
- Use the commit message format you see in `git log` (imperative mood, body explains the why)

Adapters for additional CRMs (HubSpot, Filevine, MyCase, Smokeball, PracticePanther, …) are particularly welcome. See [`docs/integrations/custom-adapter.md`](docs/integrations/custom-adapter.md) for the worked example.

For security issues, please email security@callsofia.co — do not open a public issue.

---

## License

MIT. See [LICENSE](LICENSE).

---

## Status

Production-ready for the inbound receiver, ledger, queue consumer, retry sweep, generic-webhook adapter, admin UI, and Litify adapter. Validated end-to-end against real CallSofia traffic. Open improvements (per-customer field overrides, bilingual description templates, dual-secret rotation window, integration test harness) are tracked in repo issues — none block production use.
