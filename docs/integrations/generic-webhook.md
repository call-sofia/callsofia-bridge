# Generic Webhook Forwarder

The `generic-webhook` adapter forwards every CallSofia event to a single HTTPS endpoint of your choice. Use it to drop CallSofia into a low-code automation platform (Make.com, Zapier, n8n) or any custom HTTP receiver — no Salesforce, no jsforce, no CRM SDK.

## Table of Contents

- [When to use this](#when-to-use-this)
- [Configuration](#configuration)
- [Transforms](#transforms)
- [HMAC signing](#hmac-signing)
- [Recipes](#recipes)
  - [Make.com](#makecom)
  - [Zapier](#zapier)
  - [n8n](#n8n)
- [Retry behavior & dead-lettering](#retry-behavior--dead-lettering)
- [Local testing](#local-testing)

---

## When to use this

| Scenario | Use this adapter? |
| --- | --- |
| Forward to Make.com / Zapier / n8n | ✅ |
| Custom internal HTTP service that already speaks JSON | ✅ |
| Webhook into Slack / Discord / PagerDuty (with a transform layer) | ✅ |
| Direct Salesforce / Litify writes | ❌ Use [`litify.md`](litify.md) |
| HubSpot / Filevine / MyCase | ❌ Build a [custom adapter](custom-adapter.md) — better idempotency, retries, and field mapping |

The forwarder is the simplest path to "events out of CallSofia, into something I control." It does not understand your destination's API; you (or your no-code workflow) are responsible for the actual CRM writes.

---

## Configuration

Set `CRM_ADAPTER=generic-webhook` and the forwarder-specific vars in your Vercel project:

| Var | Required | Example | Purpose |
| --- | --- | --- | --- |
| `CRM_ADAPTER` | ✅ | `generic-webhook` | Selects this adapter |
| `GENERIC_WEBHOOK_URL` | ✅ | `https://hook.eu1.make.com/abcXYZ` | Destination URL — every event POSTs here |
| `GENERIC_WEBHOOK_SECRET` | ⚙️ | `whsec_REPLACE_ME` | If set, the bridge HMAC-signs every outbound POST |
| `GENERIC_WEBHOOK_TRANSFORM` | ⚙️ | `litify-shape` (default in `.env.example`) | One of `raw`, `flat`, `litify-shape` |

Three headers are always sent:

```
content-type: application/json
x-callsofia-event: lead.qualified
x-callsofia-event-id: f3a8c7d2-8b91-4e1f-9a7c-1a2b3c4d5e6f
```

When `GENERIC_WEBHOOK_SECRET` is set, two more headers carry the signature (see [HMAC signing](#hmac-signing)).

---

## Transforms

CallSofia's webhook envelope (per [`docs/payload-spec.md`](../payload-spec.md)) is a **flat data block**:

```json
{
  "event_id": "f3a8c7d2-8b91-4e1f-9a7c-1a2b3c4d5e6f",
  "event_type": "lead.qualified",
  "emitted_at": "2026-04-30T17:43:21.123Z",
  "schema_version": 1,
  "data": {
    "call_id": "f3a8c7d2-8b91-4e1f-9a7c-1a2b3c4d5e6f",
    "caller_phone_number": "+15551234567",
    "case_type": "auto_accident",
    "summary": "Caller was rear-ended on the I-405 ...",
    "extracted_vars": {
      "incident_date": "2026-04-12",
      "injury_type": "whiplash",
      "employer_name": null
    },
    "lead": {
      "name": "Jane Doe",
      "email": "jane@example.com",
      "stage": "qualified"
    },
    "evaluation": { "score": 87, "summary": "Strong claim ..." }
  }
}
```

The bridge normalizes this into `{ scope, payload }` internally (`src/lib/webhook/envelope.ts`), then the forwarder applies a transform before POSTing. Transforms live in [`src/lib/adapters/generic-webhook/transforms.ts`](../../src/lib/adapters/generic-webhook/transforms.ts).

### `raw` — full envelope, untouched

```json
{
  "event_id": "f3a8c7d2-...",
  "event_type": "lead.qualified",
  "emitted_at": "2026-04-30T17:43:21.123Z",
  "schema_version": 2,
  "data": {
    "scope": { "org_id": "...", "workspace_id": "...", "pipeline_id": "...", "stage_id": null },
    "payload": { "call_id": "f3a8c7d2-...", "caller_phone_number": "+15551234567", "...": "..." }
  }
}
```

Best when your downstream consumer wants the full context including `scope` and `extracted_vars`.

### `flat` — flattened top-level keys

```json
{
  "event_id": "f3a8c7d2-...",
  "event_type": "lead.qualified",
  "emitted_at": "2026-04-30T17:43:21.123Z",
  "org_id": "10000000-0000-0000-0000-000000000001",
  "workspace_id": "20000000-0000-0000-0000-000000000001",
  "pipeline_id": "30000000-0000-0000-0000-000000000001",
  "call_id": "f3a8c7d2-8b91-4e1f-9a7c-1a2b3c4d5e6f",
  "caller_phone": "+15551234567",
  "case_type": "auto_accident",
  "summary": "Caller was rear-ended on the I-405 ...",
  "lead_name": "Jane Doe",
  "lead_email": "jane@example.com",
  "lead_stage": "qualified",
  "extracted": {
    "incident_date": "2026-04-12",
    "injury_type": "whiplash",
    "employer_name": null
  }
}
```

Best for spreadsheet/database destinations and for Make/Zapier scenarios where deep paths are inconvenient.

### `litify-shape` — Salesforce field names

```json
{
  "CallSofia_Event_ID__c": "f3a8c7d2-...",
  "CallSofia_Event_Type__c": "lead.qualified",
  "CallSofia_Call_ID__c": "f3a8c7d2-8b91-4e1f-9a7c-1a2b3c4d5e6f",
  "CallSofia_Phone__c": "+15551234567",
  "CallSofia_Case_Type__c": "auto_accident",
  "CallSofia_Summary__c": "Caller was rear-ended on the I-405 ...",
  "CallSofia_Incident_Date__c": "2026-04-12",
  "CallSofia_Injury_Type__c": "whiplash",
  "CallSofia_Employer_Name__c": null
}
```

Best when the downstream is a no-code Salesforce upsert (Make's Salesforce module, Zapier's "Find or Create Record") — the keys already match Litify field API names, so you can map straight through.

---

## HMAC signing

When `GENERIC_WEBHOOK_SECRET` is set, the forwarder signs every outbound request using the **same scheme as inbound** (see [`docs/security.md`](../security.md)):

```
signing_string = timestamp + "." + raw_body
signature      = "sha256=" + hex(HMAC-SHA256(secret, signing_string))
```

Headers added:

```
x-callsofia-bridge-timestamp: 2026-04-30T17:43:21.456Z
x-callsofia-bridge-signature: sha256=9f8e7d6c5b4a39281706f5e4d3c2b1a0918273645af5e6d7c8b9a0123456789
```

The timestamp is ISO 8601. The signing logic lives in [`src/lib/adapters/generic-webhook/adapter.ts`](../../src/lib/adapters/generic-webhook/adapter.ts).

### Verifying in your receiver (Node.js)

```typescript
import crypto from "crypto";

function verify(secret: string, ts: string, rawBody: string, sig: string): boolean {
  const expected = "sha256=" + crypto.createHmac("sha256", secret).update(`${ts}.${rawBody}`).digest("hex");
  return expected.length === sig.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
}
```

### Verifying in your receiver (Python)

```python
import hmac, hashlib

def verify(secret: str, ts: str, raw_body: bytes, sig: str) -> bool:
    expected = "sha256=" + hmac.new(secret.encode(), f"{ts}.".encode() + raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, sig)
```

Always reject if the timestamp is older than 5 minutes (clock-skew window) — the bridge does the same on inbound.

---

## Recipes

### Make.com

1. Create a new scenario, add a **Webhooks → Custom webhook** trigger
2. Make assigns a URL like `https://hook.eu1.make.com/abc123XYZ` — copy it
3. In your Vercel project: `GENERIC_WEBHOOK_URL=https://hook.eu1.make.com/abc123XYZ`, `GENERIC_WEBHOOK_TRANSFORM=flat`
4. Click **Re-determine data structure** in Make and trigger one test event (`pnpm tsx scripts/dev/mock-callsofia.ts`); Make captures the JSON shape
5. Add downstream modules: a Router by `event_type`, then per-branch CRM writes (Salesforce, HubSpot, Pipedrive, Airtable, Slack, …)
6. (Optional) Add **Tools → Set Variable** at the start to verify `x-callsofia-bridge-signature` against `GENERIC_WEBHOOK_SECRET` before any side-effects

### Zapier

1. Create a new Zap, choose **Webhooks by Zapier → Catch Hook**
2. Copy the hook URL into `GENERIC_WEBHOOK_URL`
3. Set `GENERIC_WEBHOOK_TRANSFORM=flat`
4. Trigger a test event so Zapier captures the payload
5. Optional second step: **Code by Zapier (JavaScript)** to verify the HMAC, then `if (!ok) throw new Error("bad sig")` so Zapier marks the run as errored
6. Continue with **Filter by Zapier** on `event_type` and your CRM action

### n8n

1. Add a **Webhook** node, mode `POST`, response `Immediately`
2. Copy the production URL into `GENERIC_WEBHOOK_URL`
3. Add an **HMAC** / **Crypto** node to verify `x-callsofia-bridge-signature` (n8n's Crypto node supports HMAC-SHA256 natively)
4. Add an **IF** node on `{{ $json.event_type === "lead.qualified" }}`
5. Branch into your CRM nodes (HubSpot, Pipedrive, Postgres, …)

---

## Retry behavior & dead-lettering

Outbound delivery is wrapped in the same retry logic as the Litify adapter (see `src/app/api/queue/consumer/route.ts`):

| Receiver responds | Adapter outcome | Bridge action |
| --- | --- | --- |
| `2xx` | `success` | `deliveries.status = succeeded`, no retry |
| `4xx` (except 429) | `failure` | `deliveries.status = failed`, no retry |
| `429` or `5xx` | `retry` | Exponential backoff (`RETRY_BASE_DELAY_MS` … `RETRY_MAX_DELAY_MS`), up to `MAX_RETRIES` attempts |
| Network error / timeout | `retry` | Same as above |
| Exhausted retries | `dead_letter` | Logged, mirrored to platform-api as `bridge.dead_letter` |

Dead-lettered events stay in the `events` table forever; you can replay them from the admin dashboard at `/admin/events`.

---

## Local testing

### With `webhook.site`

The fastest way to confirm the bridge is forwarding:

1. Open https://webhook.site → copy your unique URL
2. `GENERIC_WEBHOOK_URL=https://webhook.site/<your-uuid>`
3. `pnpm dev`
4. `pnpm tsx scripts/dev/mock-callsofia.ts http://localhost:3000/api/webhooks/callsofia`
5. Refresh webhook.site — you should see one POST per event with the configured transform

### With ngrok → your real receiver

```bash
ngrok http 5678              # if your receiver is on :5678
# copy the https://abc123.ngrok-free.app URL into GENERIC_WEBHOOK_URL
pnpm dev
pnpm tsx scripts/dev/mock-callsofia.ts
```

Useful when you want to test signature verification logic in your own service before pointing the live bridge at it.

---

See also: [`docs/security.md`](../security.md) for the full HMAC scheme, [`docs/integrations/custom-adapter.md`](custom-adapter.md) if you'd rather write a TypeScript adapter than juggle no-code, and [`docs/payload-spec.md`](../payload-spec.md) for the canonical event reference.
