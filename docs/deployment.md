# Deployment

End-to-end deployment for production use, with Vercel as the default target and a self-hosted alternative for teams that prefer to run it themselves. For the five-minute first deploy, see [`getting-started.md`](./getting-started.md). For env var details, see [`configuration.md`](./configuration.md).

## Table of Contents

- [Vercel deploy (recommended)](#vercel-deploy-recommended)
- [Production checklist](#production-checklist)
- [Crons](#crons)
- [Database migrations](#database-migrations)
- [Database options](#database-options)
- [Vercel Queues (optional)](#vercel-queues-optional)
- [Custom domains](#custom-domains)
- [Region and scaling](#region-and-scaling)
- [Self-hosted alternative](#self-hosted-alternative)
- [Rollback](#rollback)
- [Observability](#observability)

## Vercel deploy (recommended)

The fastest path is the click-to-deploy button in [`getting-started.md`](./getting-started.md). For repeat deployments or CI-driven workflows, use the CLI.

```bash
# 1. Clone (or fork on GitHub then clone)
git clone https://github.com/<your-org>/callsofia-bridge.git
cd callsofia-bridge

# 2. Link to a Vercel project (interactive on first run)
npx vercel link

# 3. Provision Postgres via the Marketplace (or set DATABASE_URL manually)
#    Vercel dashboard → Storage → Create → Neon Postgres

# 4. Set required env vars (see "Production checklist" below)
vercel env add CALLSOFIA_API_BASE_URL production
vercel env add CALLSOFIA_ORG_ID production
vercel env add CALLSOFIA_API_KEY production
vercel env add CALLSOFIA_WEBHOOK_SECRET production
vercel env add ADMIN_PASSWORD production
vercel env add CRM_ADAPTER production
vercel env add NEXT_PUBLIC_BASE_URL production

# 5. Pull env into your local shell (optional, for local builds)
vercel env pull .env.local

# 6. Deploy
vercel --prod
```

Push-to-deploy works the same way — once the GitHub repo is linked to the Vercel project, every push to `main` triggers a production build, every push to a feature branch creates a preview.

## Production checklist

**Must set before first deploy:**

- `DATABASE_URL` — auto-injected by the Neon Marketplace integration, or set manually
- `CALLSOFIA_API_BASE_URL`
- `CALLSOFIA_ORG_ID`
- `CALLSOFIA_API_KEY`
- `CALLSOFIA_WEBHOOK_SECRET`
- `ADMIN_PASSWORD`
- `CRM_ADAPTER` (use `none` for the first deploy)
- `NEXT_PUBLIC_BASE_URL` — set this to your deploy URL if you're not using Vercel Queues; the in-process consumer fallback POSTs back to it

**Should set later (when wiring downstream):**

- `SALESFORCE_LOGIN_URL`, `SALESFORCE_CLIENT_ID`, `SALESFORCE_CLIENT_SECRET` — Litify only
- `INTAKE_DEFAULT_OWNER_ID`, `INTAKE_COORDINATOR_USER_ID`, `LITIFY_INTAKE_RECORD_TYPE_ID`, `LITIFY_RECORDING_MODE` — Litify only
- `GENERIC_WEBHOOK_URL`, `GENERIC_WEBHOOK_SECRET`, `GENERIC_WEBHOOK_TRANSFORM` — Generic adapter only
- `HANDLE_*` toggles — defaults match common usage; tweak only if you need to enable additional event types
- `MAX_RETRIES`, `RETRY_BASE_DELAY_MS`, `RETRY_MAX_DELAY_MS`, `DEAD_LETTER_AFTER_DAYS` — defaults are sane
- `SLACK_ALERT_WEBHOOK_URL` — for dead-letter alerts
- `MIRROR_TO_PLATFORM_API` — defaults to `true`; set `false` only if you don't want cross-side observability
- `LOG_LEVEL` — defaults to `info`

The full reference is in [`configuration.md`](./configuration.md).

## Crons

Two crons are declared in [`vercel.json`](../vercel.json):

| Path | Schedule | Implementation |
|---|---|---|
| `/api/cron/process-retries` | `* * * * *` (every minute) | [`src/app/api/cron/process-retries/route.ts`](../src/app/api/cron/process-retries/route.ts) |
| `/api/cron/health-check` | `*/5 * * * *` (every 5 minutes) | [`src/app/api/cron/health-check/route.ts`](../src/app/api/cron/health-check/route.ts) |

Vercel Cron invokes these as authenticated GETs — Vercel adds the required header automatically, you don't have to wire anything up. Cron is enabled on Hobby plans for one job and on Pro plans for unlimited; check your plan limits if you see crons silently not firing.

You can also hit either endpoint manually for debugging:

```bash
curl https://your-bridge.vercel.app/api/cron/health-check
```

## Database migrations

Drizzle migrations run at build time per the `buildCommand` in [`vercel.json`](../vercel.json):

```json
{ "buildCommand": "pnpm db:migrate && pnpm build" }
```

This means every deploy applies pending migrations against `DATABASE_URL` before building the Next.js app. The Drizzle journal is committed at `src/lib/db/migrations/meta/_journal.json` — that file is what makes the migrate step idempotent. **Never delete it.**

To generate a new migration locally after editing [`src/lib/db/schema.ts`](../src/lib/db/schema.ts):

```bash
pnpm db:generate    # creates a new SQL file under src/lib/db/migrations/
git add src/lib/db/migrations
```

To apply ad-hoc against a DB without running the full build:

```bash
pnpm db:migrate
```

For local schema iteration without the migration file overhead:

```bash
pnpm db:push        # destructive — overwrites the schema in the linked DB
```

## Database options

Anything that speaks Postgres works. Connection-string formats:

| Provider | `DATABASE_URL` shape |
|---|---|
| **Neon** (recommended) | `postgresql://user:pass@ep-xxx-pooler.region.aws.neon.tech/dbname?sslmode=require` |
| **Supabase Postgres** | `postgres://postgres.<ref>:pass@aws-0-<region>.pooler.supabase.com:6543/postgres?pgbouncer=true` (note: pooler subdomain prefix varies by region — `aws-0-` vs `aws-1-`) |
| **AWS RDS** | `postgresql://user:pass@<endpoint>.rds.amazonaws.com:5432/dbname` |
| **Self-hosted** | `postgresql://user:pass@host:5432/dbname` |

For Vercel deployments, prefer the pooled connection string — Vercel Functions are short-lived and burst-spawn under load, which exhausts non-pooled limits quickly. Neon's `-pooler` endpoint and Supabase's `pgbouncer=true` are the right defaults.

## Vercel Queues (optional)

By default, the receiver POSTs queue messages directly to its own `/api/queue/consumer` route via fetch. That works fine — Vercel Functions can self-invoke — but it ties consumer execution to receiver invocation.

For better isolation, enable Vercel Queues:

1. Provision a queue in your Vercel project
2. Set `VERCEL_QUEUE_PUBLISH_URL` to the publish endpoint
3. Set `QUEUE_TOKEN` to the queue auth token
4. Configure the queue to invoke `https://your-bridge.vercel.app/api/queue/consumer`

When `VERCEL_QUEUE_PUBLISH_URL` is unset, the bridge uses the in-process fallback. **In that case you must set `NEXT_PUBLIC_BASE_URL`** — otherwise the fallback POSTs to `http://localhost:3000` and silently fails. Setting `QUEUE_INTERNAL_TOKEN` is also recommended; the fallback sends it in `x-queue-token` and the consumer route checks it.

## Custom domains

In the Vercel dashboard: **Project → Settings → Domains → Add**. Point your DNS at Vercel (CNAME `cname.vercel-dns.com` for subdomains, A/AAAA for apex). After provisioning, **update**:

- The CallSofia webhook subscription URL to use your custom domain
- `NEXT_PUBLIC_BASE_URL` to match the custom domain

## Region and scaling

The bridge is mostly I/O bound (Postgres + Salesforce REST + outbound webhooks). Default Vercel settings — Fluid Compute, Node.js 20+ (per [`package.json`](../package.json) `engines.node`), no explicit region pinning — handle hundreds of events per minute without tuning.

If you're forwarding to Salesforce, pin the function to a region close to your Salesforce instance (typically `iad1` for US East orgs) to shave 50–100 ms off each call. Set the region in the Vercel dashboard or in `vercel.json`:

```json
{ "regions": ["iad1"] }
```

If you observe Postgres connection-limit errors under load, note that the pool size is hardcoded at `max:3` in [`src/lib/db/client.ts`](../src/lib/db/client.ts) (sized for Neon's pgBouncer transaction-mode budget per Function instance) and the postgres.js client ignores connection-string pool params. Raising the pool requires a code change there — not a `DATABASE_URL` query-string tweak. Alternatively, upgrade to a larger Postgres plan or a non-pooled endpoint.

## Self-hosted alternative

The repo builds as a standard Next.js app — no Vercel-specific runtime requirements. To run it on your own infra:

```bash
# Build a production image
docker build -t callsofia-bridge .

# Run it
docker run -d --name bridge \
  -p 3000:3000 \
  -e DATABASE_URL=postgresql://user:pass@db:5432/bridge \
  -e CALLSOFIA_API_BASE_URL=https://api.callsofia.co \
  -e CALLSOFIA_ORG_ID=… \
  -e CALLSOFIA_API_KEY=sk_prod_… \
  -e CALLSOFIA_WEBHOOK_SECRET=whsec_… \
  -e ADMIN_PASSWORD=… \
  -e CRM_ADAPTER=none \
  -e NEXT_PUBLIC_BASE_URL=https://bridge.example.com \
  callsofia-bridge
```

> **Note:** the repo doesn't yet ship a `Dockerfile` and [`next.config.ts`](../next.config.ts) doesn't currently set `output: "standalone"`. If you want to self-host, you'll need to add both. A minimal Dockerfile:
>
> ```dockerfile
> FROM node:20-alpine
> WORKDIR /app
> RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
> COPY pnpm-lock.yaml package.json ./
> RUN pnpm install --frozen-lockfile
> COPY . .
> RUN pnpm db:migrate
> RUN pnpm build
> EXPOSE 3000
> CMD ["pnpm", "start"]
> ```
>
> The `pnpm db:migrate` step requires `DATABASE_URL` to be set at build time. If you'd rather defer migrations to container startup, move that line into an entrypoint script. Do **not** mask migration failures with `|| true` — a failed migration must abort the build, not silently ship a broken schema.

Self-hosting also requires you to schedule the two cron paths yourself (e.g. via `cron`, Kubernetes CronJob, or GitHub Actions hitting the URLs). The handlers are idempotent — overlapping ticks are safe (see [`architecture.md`](./architecture.md#atomic-retry-claim)).

## Rollback

Vercel keeps every deployment indefinitely. To roll back:

```bash
vercel rollback                       # picks the previous production deploy
vercel rollback <deployment-url>      # specific deployment
```

Or in the dashboard: **Project → Deployments → click target → Promote to Production**.

Database migrations are append-only in Drizzle. If a deploy includes a destructive migration, **rolling back the deploy does not roll back the migration** — you'll need to write a corrective migration or restore from a Postgres snapshot. Test schema changes in a preview environment first.

## Observability

Every event the bridge processes is mirrored to platform-api `/v1/logs` with `event_type` prefixed `bridge.` (e.g. `bridge.event_received`, `bridge.handler_succeeded`, `bridge.dead_letter`, `bridge.health_check`). You can query CallSofia's `activity_logs` table to verify deliveries from the upstream side without touching the bridge.

Local visibility:

- **Admin UI** — `https://your-bridge.vercel.app/admin` (basic-auth, password = `ADMIN_PASSWORD`). Lists the 100 most recent events with deep links to per-event detail.
- **Health endpoint** — `GET /api/cron/health-check` returns `{"healthy":true,"checks":{"postgres":…,"adapter":…}}`. Wire your monitoring (UptimeRobot, Better Stack, etc.) to this.
- **Vercel logs** — `vercel logs <deployment-url>` or the dashboard's Logs tab.

For specific failure modes see [`troubleshooting.md`](./troubleshooting.md).
