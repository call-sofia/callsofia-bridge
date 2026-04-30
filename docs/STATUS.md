# Implementation Status

> **As of 2026-04-29.** Source of truth: `git log --oneline` on `main`.

## Completed (4 of 36 tasks)

| # | Task | PR | Files |
|---|---|---|---|
| 1 | Bootstrap repo, Next.js scaffold, deps locked, build passes | — | `package.json`, `tsconfig.json`, `next.config.ts`, `vercel.json`, `vitest.config.ts`, `drizzle.config.ts`, `src/app/{layout,page}.tsx`, `.env.example`, `README.md` |
| 2 | Env-var config with zod validation | #1 | `src/lib/config.ts`, `src/lib/config.test.ts` |
| 3 | Drizzle schema for events/deliveries/retry_queue/config_overrides | #3 | `src/lib/db/{schema,client,schema.test}.ts` |
| 4 | Upstash Redis client with idempotency helper | #2 | `src/lib/redis/{client,client.test}.ts` |

All 4 PRs squash-merged. Tests: 9/9 passing. `pnpm tsc --noEmit` clean. `pnpm build` clean.

## Remaining (32 of 36 tasks)

See [`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md) for full task content. Wave breakdown:

| Wave | Tasks | Description | Parallel? |
|---|---|---|---|
| 1 (rest) | 5, 6, 7 | Logger, webhook envelope schemas, HMAC verify | ✅ Independent |
| 2 | 8, 9, 10 | Webhook receiver route, platform-api client, queue plumbing | ✅ Independent |
| 3 | 11, 12 | Adapter interface + registry | Mostly |
| 4 | 13, 14, 15, 16 | Litify auth, field mapping, case-type cache, generic transforms | ✅ Independent |
| 5 | 17, 18, 19, 20, 21 | Litify person/intake/activity/recording, generic adapter | ✅ Independent |
| 6 | 22 | Compose `LitifyAdapter` | Sequential |
| 7 | 23 | Wire queue consumer to adapters | Sequential |
| 8 | 24, 25, 26, 27, 28, 29, 30 | Cron jobs + admin dashboard | ✅ Independent |
| 9 | 31, 32, 33 | Litify field setup script, mock dev server, replay CLI | ✅ Independent |
| 10 | 34, 35, 36 | CI workflow, README/deployment/troubleshooting docs, Litify guide | ✅ Independent |

## Outstanding User Actions (cannot be done by Claude)

1. **Vercel link:** `cd /path/to/callsofia-bridge && vercel link` (interactive)
2. **Provision Marketplace integrations** (auto-injects env vars):
   - Neon Postgres → `DATABASE_URL`
   - Upstash Redis → `REDIS_URL`, `REDIS_TOKEN`
3. **Salesforce Connected App** for Litify integration (covered in `litify-setup-guide.md` once Task 36 ships, or follow Salesforce docs for OAuth Username-Password flow)
4. **CallSofia API key + webhook secret** generated from CallSofia dashboard for the new client deployment
5. **GitHub repo settings:**
   - Branch protection on `main` (require PR review, status checks)
   - Optionally restrict who can push/merge

## How to Continue

Open a Claude Code session rooted in this repo:

```bash
cd /Users/rey/Documents/GitHub/callsofia-bridge
claude
```

Then:

> "Execute Tasks 5-36 from `docs/IMPLEMENTATION_PLAN.md` using the `superpowers:subagent-driven-development` skill. The plan is fully specified — every task has TDD steps, exact file paths, and complete code blocks. Tasks within each wave are independent; dispatch implementer subagents per task. Branch `task/NN-name` per task, push, open PR, merge with `gh pr merge --squash --delete-branch --admin`, then move to the next."

A session rooted in this repo has no sandbox issues — the bridge codebase is the trusted directory.

## Architecture Summary

See [`DESIGN.md`](DESIGN.md) for the full 976-line design spec. Key points:

- One Vercel deploy per client (hybrid tenancy)
- Pluggable `CrmAdapter` interface; Litify primary, Generic Webhook fallback
- Vercel Queues for at-least-once durable delivery
- Neon Postgres event ledger + per-handler delivery state
- Upstash Redis for idempotency + auth-token cache
- All operations mirrored to CallSofia `/v1/activity-logs` for end-to-end CallSofia-side observability
- HMAC-SHA256 inbound; OAuth 2.0 to Salesforce outbound
- `/admin` Next.js dashboard, basic-auth gated
