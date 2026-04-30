# CallSofia Bridge

Webhook middleware between [CallSofia](https://callsofia.co) AI voice intake and your CRM.

> **Status:** Bootstrapping. Implementation in progress per [`docs/superpowers/plans/2026-04-29-callsofia-bridge.md`](https://github.com/call-sofia/SofiaWeb/blob/main/docs/superpowers/plans/2026-04-29-callsofia-bridge.md) (private).

**Default CRM:** Litify (Salesforce-based legal case management).
**Pluggable adapters:** Generic Webhook Forwarder out of the box; HubSpot, Filevine, MyCase planned.

---

## Architecture

```
CallSofia → POST /api/webhooks/callsofia → Postgres ledger → Vercel Queue
                                                   ↓
                               Queue Consumer → CrmAdapter (Litify | Generic)
                                                   ↓
                                             Salesforce / Litify
                                                   ↓
                          Mirror outcome → CallSofia /v1/activity-logs
```

Each client gets their own Vercel deployment from this codebase, configured
with that client's CallSofia api-key, Litify credentials, and behavior rules
via env vars.

## Quick Start

1. **Fork** this repo
2. **Vercel:** Import project, link to your fork
3. **Marketplace:** Add Neon Postgres + Upstash Redis (auto-injects env vars)
4. **Salesforce:** Create a Connected App, run `./scripts/litify/create-custom-fields.sh`
5. **Env vars:** Set all from [`.env.example`](.env.example) in Vercel
6. **Deploy:** Push to main → Vercel auto-deploys
7. **Register:** Add your bridge URL to CallSofia dashboard webhooks

See [`docs/`](docs/) for detailed guides:

- [`deployment.md`](docs/deployment.md) — full deployment walkthrough
- [`litify-setup-guide.md`](docs/litify-setup-guide.md) — Salesforce + Litify configuration
- [`troubleshooting.md`](docs/troubleshooting.md) — common issues
- [`adding-a-crm-adapter.md`](docs/adding-a-crm-adapter.md) — extend with a new CRM

## Tech Stack

- **Framework:** Next.js 16 App Router (Vercel Fluid Compute, Node.js 24)
- **Database:** Neon Postgres via Drizzle ORM
- **Cache / Idempotency:** Upstash Redis
- **Queue:** Vercel Queues (durable, at-least-once)
- **CRM SDK:** [jsforce](https://jsforce.github.io/) for Salesforce / Litify
- **Validation:** Zod
- **Tests:** Vitest

## Development

```bash
pnpm install
cp .env.example .env.local  # then fill in values
pnpm db:push                 # apply schema to local Postgres
pnpm dev                     # http://localhost:3000

# In another terminal, replay canned events:
pnpm tsx scripts/dev/mock-callsofia.ts
```

## License

Proprietary. © Call Sofia.
