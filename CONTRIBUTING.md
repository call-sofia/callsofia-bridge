# Contributing to callsofia-bridge

Thanks for considering a contribution. The bridge is an open-source integration layer — we welcome bug fixes, new CRM adapters, doc improvements, and observability enhancements.

## Ground rules

1. **Read [`CLAUDE.md`](CLAUDE.md) first.** It's the single best onboarding doc — covers architecture, conventions, and gotchas in one screen.
2. **Tests must pass.** `pnpm tsc --noEmit && pnpm vitest run` before pushing. CI runs the same.
3. **Idempotency is invariant.** Any code path that processes an event must tolerate re-delivery. The queue can replay the same `event_id` indefinitely.
4. **Public surface changes need docs.** If you change env vars, the envelope shape, or the adapter contract, update the relevant `docs/` file and `.env.example` in the same PR.
5. **Use the existing patterns.** Look at neighboring code before inventing a new approach.

## Development setup

```bash
git clone https://github.com/<your-fork>/callsofia-bridge.git
cd callsofia-bridge
pnpm install
cp .env.example .env.local
# Set DATABASE_URL to a free Neon Postgres or local Postgres
pnpm db:migrate
pnpm dev
```

In another terminal:

```bash
pnpm vitest          # watch mode
pnpm tsc --noEmit    # type check
```

## Branching + PRs

- Branch off `main`. Name with intent: `fix/timestamp-parser-iso8601`, `feat/hubspot-adapter`, `docs/getting-started-clarify-deploy-step`.
- One logical change per PR. Big refactors broken into small, reviewable commits.
- Commit messages: imperative mood (`fix: accept unix-seconds timestamps`), body explains the WHY, not the what (the diff shows the what).
- PR description follows the template (`.github/pull_request_template.md` if present, otherwise: Summary / Why / Test plan).
- Squash-merge to `main`.

## Adding a CRM adapter

Walk through [`docs/integrations/custom-adapter.md`](docs/integrations/custom-adapter.md). The Litify adapter (`src/lib/adapters/litify/`) is the worked example. New adapters need:

1. The `CrmAdapter` interface implemented (see `src/lib/adapters/types.ts`)
2. Registration in `src/lib/adapters/registry.ts`
3. Env vars in `src/lib/config.ts` (zod schema) and `.env.example`
4. Tests covering all four outcomes: `success`, `noop`, `retry`, `failure`
5. A doc page in `docs/integrations/<name>.md`
6. Idempotency: handle the same `event_id` arriving twice gracefully

## Reporting bugs

Open a GitHub issue with:

- What you expected
- What happened
- Reproduction steps (curl + body that triggers it is gold)
- Bridge deployment URL or local repro
- Relevant log lines from `vercel logs` or `pnpm dev`

## Security issues

**Do not open a public issue for security vulnerabilities.** Email security@callsofia.co with details. We aim to respond within 72 hours.

## Code style

- TypeScript strict, no `any` outside foreign-API wrappers
- Structured JSON logging via `src/lib/logger.ts`
- Prefer `unknown` + zod parse at boundaries
- Never construct external clients at module-import time (cold-start safety) — use lazy initialization

See [`CLAUDE.md`](CLAUDE.md) → "Conventions to follow" for the full list.

## Documentation style

- GitHub-flavored markdown
- Code blocks with language tags
- Each doc opens with a one-paragraph "what is this" + ToC
- Cross-link liberally; don't duplicate
- Keep examples real (use real env var names, real envelope shapes)

## Release process

The bridge has no semver release cadence — it's deployed continuously. Each merge to `main` becomes a Vercel deployment. Customers running their own forks track `main` or pin to a SHA they trust.

If you maintain a long-term fork, follow the upstream `main` for compatibility-relevant changes (envelope shape, adapter contract). Internal-only changes (refactors, perf) are safe to skip.

## License

By contributing you agree your work is licensed under the MIT License (see [LICENSE](LICENSE)).
