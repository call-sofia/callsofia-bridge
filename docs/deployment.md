# Deployment Guide

## Step-by-step (per-client deployment)

1. **Fork** `github.com/call-sofia/callsofia-bridge`
2. **Vercel:** Import the fork as a new Vercel project under your account/team
3. **Marketplace integrations** (auto-injects env vars):
   - Add **Neon Postgres** → injects `DATABASE_URL`
   - Add **Upstash Redis** → injects `REDIS_URL` and `REDIS_TOKEN`
4. **Salesforce:** Create a Connected App (see `litify-setup-guide.md`), note Client ID + Secret + Security Token
5. **Custom fields:** Run `./scripts/litify/create-custom-fields.sh <org-alias>` against your Salesforce org
6. **Env vars:** In Vercel project settings, set all values from `.env.example`. Required:
   - `CALLSOFIA_API_BASE_URL`, `CALLSOFIA_ORG_ID`, `CALLSOFIA_API_KEY`, `CALLSOFIA_WEBHOOK_SECRET` (provided by CallSofia)
   - `SALESFORCE_*` (from your Connected App)
   - `ADMIN_PASSWORD` (your choice — used to gate `/admin`)
7. **Deploy:** Push to `main`. Vercel auto-builds and runs database migrations as part of the build.
8. **Register webhook URL** in CallSofia dashboard: `https://your-bridge.vercel.app/api/webhooks/callsofia`
9. **Verify:** Place a test call → check `/admin` for confirmation that the event arrived and was processed.

## Rollback

Use Vercel's instant rollback: project → Deployments → click previous deployment → "Promote to Production".

Database migrations are append-only by Drizzle convention — manually revert schema changes if needed via a new migration.

## Updating

- **Pull upstream changes:** `git pull upstream main` (if you forked)
- **Test in Preview:** open a PR; Vercel auto-creates a preview deployment with its own DB branch
- **Promote:** merge to `main`

## Vercel Cron Jobs

Configured in `vercel.json`:

| Path | Schedule |
|---|---|
| `/api/cron/process-retries` | every minute |
| `/api/cron/health-check` | every 5 minutes |

These run automatically on Vercel without configuration. They mirror their results to CallSofia `/v1/activity-logs` so health is observable from CallSofia's side.
