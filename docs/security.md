# Security

This document covers the bridge's security model: how inbound CallSofia webhooks are authenticated, how the admin UI is protected, what threats the design addresses, and how to rotate secrets and report vulnerabilities.

## Table of Contents

- [Inbound webhook signing (HMAC-SHA256)](#inbound-webhook-signing-hmac-sha256)
- [Timestamp freshness](#timestamp-freshness)
- [Idempotency](#idempotency)
- [Admin authentication](#admin-authentication)
- [Internal queue authentication](#internal-queue-authentication)
- [Secrets management](#secrets-management)
- [Threat model](#threat-model)
- [Rotating the webhook secret](#rotating-the-webhook-secret)
- [Reporting vulnerabilities](#reporting-vulnerabilities)

---

## Inbound webhook signing (HMAC-SHA256)

CallSofia signs every outbound webhook using HMAC-SHA256 over a `timestamp.body` signing string. The bridge verifies the signature in [`src/lib/webhook/verify.ts`](../src/lib/webhook/verify.ts) before doing anything else with the request.

### The signing scheme

```
signing_string = timestamp + "." + raw_body
signature      = "sha256=" + hex(HMAC-SHA256(secret, signing_string))
```

Headers on every inbound POST:

```
x-callsofia-timestamp: 1714501234           (or ISO 8601 — see below)
x-callsofia-signature: sha256=9f8e7d6c5b4a39281706f5e4d3c2b1a0918273645af5e6d7c8b9a0123456789
```

### Verification (TypeScript — what the bridge does)

```typescript
import crypto from "crypto";

export function verifySignature(
  secret: string,
  timestamp: string,
  rawBody: Buffer,
  signatureHeader: string,
): boolean {
  if (!signatureHeader.startsWith("sha256=")) return false;
  const signingString = Buffer.concat([
    Buffer.from(timestamp, "utf-8"),
    Buffer.from(".", "utf-8"),
    rawBody,
  ]);
  const expected = "sha256=" + crypto.createHmac("sha256", secret).update(signingString).digest("hex");
  if (expected.length !== signatureHeader.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signatureHeader));
}
```

### Verification (Python — for reproducing in your own tooling)

```python
import hmac, hashlib

def verify_signature(secret: str, timestamp: str, raw_body: bytes, signature_header: str) -> bool:
    if not signature_header.startswith("sha256="):
        return False
    signing_string = timestamp.encode("utf-8") + b"." + raw_body
    expected = "sha256=" + hmac.new(secret.encode("utf-8"), signing_string, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature_header)
```

### Critical implementation notes

- ✅ **Sign over `raw_body`** — never `JSON.stringify(parse(body))`; key ordering and whitespace differences will silently break verification
- ✅ **Constant-time compare** — `crypto.timingSafeEqual` (Node) / `hmac.compare_digest` (Python). Don't use `===` / `==`
- ✅ **Reject if the header is missing or doesn't start with `sha256=`** — don't fall through to "no signature = trust it"
- ❌ **Don't trim or normalize the body** before hashing (e.g. don't strip BOM, don't re-encode)

Test fixtures in [`src/lib/webhook/verify.test.ts`](../src/lib/webhook/verify.test.ts) cover the edge cases.

---

## Timestamp freshness

The bridge rejects requests where `x-callsofia-timestamp` is more than **300 seconds** off from `now()`. This bounds replay-attack windows: even with a valid signature, an attacker can only replay a captured request for 5 minutes.

The verifier accepts **two formats** (recent fix):

| Format | Example | Source |
| --- | --- | --- |
| UNIX seconds | `1714501234` | Platform-api emits the timestamp as UNIX seconds — what production sends today |
| ISO 8601 | `2026-04-30T17:43:21.456Z` | older clients, the bridge's own outbound `generic-webhook` adapter, and test fixtures |

The detection rule (`src/lib/webhook/verify.ts:30-42`): a 10–13 digit numeric string is treated as UNIX seconds (or milliseconds for 13 digits); anything else goes through `Date.parse()`.

**5 minutes is the right window** — large enough to absorb client/server clock skew (NTP drift, container suspension), small enough that a captured signature isn't usefully replayable. Don't widen this without a specific reason.

---

## Idempotency

The `events` table primary key is `event_id`. The webhook handler ([`src/app/api/webhooks/callsofia/route.ts`](../src/app/api/webhooks/callsofia/route.ts)) uses a one-trip `INSERT … ON CONFLICT DO NOTHING RETURNING` to atomically claim each event:

```typescript
const inserted = await db.insert(schema.events).values({ eventId, /* ... */ })
  .onConflictDoNothing()
  .returning({ eventId: schema.events.eventId });

if (inserted.length === 0) {
  return NextResponse.json({ ok: true, duplicate: true }, { status: 200 });
}
```

Behavior:

- **First delivery** — row inserted, queue publish fires, mirror to platform-api fires, response `200 {"ok": true}`
- **Duplicate POST with same `event_id`** — insert returns no row, **no queue publish**, **no mirror**, response `200 {"ok": true, "duplicate": true}`

This means CallSofia can safely retry without coordinating with the bridge: a successful or duplicate response is indistinguishable to the sender, and the bridge does the right thing in both cases. No Redis or external KV is needed — the Postgres PK is the source of truth.

Adapters get the same guarantee at the consumer layer: the queue may re-deliver an `event_id` after a `retry` outcome, so `handle()` must be idempotent. See [`docs/integrations/custom-adapter.md`](integrations/custom-adapter.md#idempotency-contract).

---

## Admin authentication

The admin dashboard (`/admin/*`) and admin API (`/api/admin/*`) sit behind HTTP Basic Auth, enforced by [`src/middleware.ts`](../src/middleware.ts). The matcher is exhaustive:

```typescript
export const config = { matcher: ["/admin/:path*", "/api/admin/:path*"] };
```

### What's checked

- **Username:** ignored — anything works (the bridge isn't multi-user)
- **Password:** compared in **constant time** against `process.env.ADMIN_PASSWORD`
- If `ADMIN_PASSWORD` is unset, the middleware returns `500 Server misconfigured` rather than failing open

The constant-time comparison is implemented inline (the Edge runtime doesn't expose `crypto.timingSafeEqual`):

```typescript
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;     // length leak is acceptable here
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
```

### Recommendations

- Use a **random 32+ char password** — Basic Auth has no rate limiting, so weak passwords are brute-forceable
- Set `ADMIN_PASSWORD` only in Vercel **encrypted** env vars (never `.env` committed to git)
- For multi-user access or audit logs, replace this layer with [Vercel Authentication](https://vercel.com/docs/security/deployment-protection) or front the deployment with Cloudflare Access

---

## Internal queue authentication

The queue consumer at `/api/queue/consumer` is the worker endpoint that picks events off the queue and runs them through the active adapter. It's intended to be called by Vercel Queues (or, in the in-process fallback, by the publisher itself within the same deployment).

Authentication is **opt-in** ([`src/app/api/queue/consumer/route.ts:40-43`](../src/app/api/queue/consumer/route.ts)):

```typescript
const internalToken = process.env.QUEUE_INTERNAL_TOKEN;
if (internalToken && req.headers.get("x-queue-token") !== internalToken) {
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}
```

| `QUEUE_INTERNAL_TOKEN` | Behavior |
| --- | --- |
| Unset | Endpoint accepts any caller (relies on Vercel-internal routing) |
| Set | Caller must send matching `x-queue-token` header |

**Set this in production.** Even though the route only operates on `event_id`s already in the bridge's own database (so an attacker can't inject new events here), an unauthenticated consumer endpoint can be abused to:

- Replay processing of dead-lettered events
- Trigger duplicate CRM writes (mitigated by adapter idempotency, but still noise)
- Exhaust adapter retry budgets

---

## Secrets management

| Environment | Storage |
| --- | --- |
| Local dev | `.env.local` (in `.gitignore`; never commit) |
| CI | GitHub Actions encrypted secrets |
| Production | Vercel encrypted env vars |
| Team-shared (rotation tracking, break-glass) | 1Password CLI (`op://`) or AWS Secrets Manager |

### What must be a secret

| Var | Why |
| --- | --- |
| `CALLSOFIA_API_KEY` | Authenticates the bridge to platform-api for activity-log mirroring |
| `CALLSOFIA_WEBHOOK_SECRET` | Verifies inbound webhooks — disclosure lets anyone forge events |
| `SALESFORCE_CLIENT_SECRET` | OAuth client credential — disclosure = full Salesforce API access |
| `GENERIC_WEBHOOK_SECRET` | Lets your downstream verify the bridge — disclosure breaks downstream trust |
| `ADMIN_PASSWORD` | Admin dashboard access |
| `QUEUE_INTERNAL_TOKEN` | Queue consumer access |
| `DATABASE_URL` | Full DB read/write |

### Anti-patterns

- ❌ Committing any `.env*` file other than `.env.example`
- ❌ Logging secrets (the logger redacts known keys but not custom names — check before adding new ones)
- ❌ Using the same secret across multiple deployments (one tenant compromised = all compromised)
- ❌ Sharing secrets in chat, even briefly

---

## Threat model

### What the bridge protects against

✅ **Replay attacks** — 5-minute timestamp window + constant-time signature check
✅ **Tampering** — HMAC over the raw body detects any byte modification
✅ **Forgery** — without the webhook secret, you can't produce a valid signature
✅ **Duplicate delivery** — `events.event_id` PK ensures exactly-once processing per `event_id`
✅ **Unauthorized admin access** — Basic Auth with constant-time password compare
✅ **Cross-tenant blast radius** — each customer gets their own deployment + secrets; one tenant's compromise doesn't reach another

### What the bridge does NOT protect against

❌ **DoS / volumetric attacks** — no per-IP rate limiting; rely on Vercel's edge protections and CallSofia's outbound rate limiting
❌ **Source-side abuse** — if CallSofia itself is compromised, the bridge will faithfully forward malicious events. Trust boundary is at platform-api
❌ **Salesforce / downstream-CRM compromise** — the bridge has the same blast radius as its OAuth credentials. Rotate quickly if a token leaks
❌ **Insider attacks via the admin password** — anyone with `ADMIN_PASSWORD` can replay events, view raw payloads (containing PII), and delete deliveries. There is no audit log of admin actions
❌ **TLS downgrade / MITM** — assumed to be solved by HTTPS; the bridge does not pin certificates

### Data handling

- Raw event payloads are stored in `events.payload` and `events.raw_envelope` (Postgres). They contain caller PII (phone numbers, names, summaries, transcripts)
- Default Postgres region is the US. For EU data residency, deploy to Vercel EU + a Postgres in EU
- The bridge does **not** encrypt payloads at rest beyond the database's transparent encryption — if your threat model needs application-layer encryption, fork and add it before storing

---

## Rotating the webhook secret

> ⚠️ **Today, rotation requires a brief window of failed deliveries.** Multi-secret support (accepting both old and new during a rollover) is **not yet implemented**. Recommended: schedule a 1–2 minute maintenance window.

### Procedure (current)

1. Generate a new secret: `openssl rand -hex 32`
2. Update `CALLSOFIA_WEBHOOK_SECRET` in your Vercel project (Production env)
3. Trigger a redeploy — Vercel rolls the env into the new function instances
4. In the CallSofia dashboard (Settings → Webhooks), update the secret for this endpoint
5. CallSofia's outbound retry policy will replay any failed deliveries within ~5 min

Events that arrive during the window between step 3 (bridge has new secret) and step 4 (CallSofia still using old secret) will fail signature verification (`401`), be retried by CallSofia per its delivery policy, and eventually succeed.

### Procedure (planned — multi-secret rollover)

A future change will allow `CALLSOFIA_WEBHOOK_SECRET` to be a comma-separated list, with verification accepting any matching secret. This will enable zero-downtime rotation:

1. Add the new secret to the list: `CALLSOFIA_WEBHOOK_SECRET=old,new` → redeploy
2. Update CallSofia to use `new`
3. After 24 hours, remove `old` from the list → redeploy

Until that ships, use the brief-window procedure above.

---

## Reporting vulnerabilities

If you discover a security issue in the bridge or its packaging, please report it privately:

📧 **security@callsofia.co**

Please include:

- A description of the vulnerability and its impact
- Steps to reproduce (or a proof-of-concept)
- The commit SHA or release tag you tested against
- Your contact info if you'd like credit in the disclosure

We aim to acknowledge reports within 2 business days and to ship a fix or mitigation within 14 days for high-severity issues. Please **do not** open a public GitHub issue for vulnerabilities — coordinate disclosure with us first.
