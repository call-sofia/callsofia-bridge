# Building a Custom CRM Adapter

The bridge ships with two adapters — [`litify`](litify.md) for Salesforce/Litify and [`generic-webhook`](generic-webhook.md) for any HTTPS receiver — but the architecture is built around a single TypeScript interface. Adding HubSpot, Filevine, MyCase, Pipedrive, or your home-grown CRM is a self-contained change in `src/lib/adapters/<your-crm>/`.

## Table of Contents

- [The `CrmAdapter` interface](#the-crmadapter-interface)
- [Worked example: `LitifyAdapter`](#worked-example-litifyadapter)
- [Step-by-step: scaffolding `hubspot/`](#step-by-step-scaffolding-hubspot)
- [Registering the adapter](#registering-the-adapter)
- [Test fixture pattern](#test-fixture-pattern)
- [Idempotency contract](#idempotency-contract)
- [Retry vs failure semantics](#retry-vs-failure-semantics)
- [Outcome → `deliveries.status` mapping](#outcome--deliveriesstatus-mapping)

---

## The `CrmAdapter` interface

From [`src/lib/adapters/types.ts`](../../src/lib/adapters/types.ts):

```typescript
import type { CallSofiaEvent } from "../webhook/types";
import type { ActivityLogEntry } from "../platform-api/activity-logs";

export interface AdapterContext {
  platformApi: {
    logActivity(entry: ActivityLogEntry): Promise<void>;
    getCallDetail(callId: string): Promise<{ id: string; [k: string]: unknown }>;
  };
  config: Record<string, unknown>;
}

export interface HandlerResult {
  outcome: "success" | "noop" | "failure" | "retry";
  crm_record_id?: string;
  crm_record_url?: string;
  message?: string;
  error?: { code: string; message: string; retryable: boolean };
  api_calls?: number;
}

export interface HealthStatus {
  healthy: boolean;
  message?: string;
  timestamp: Date;
}

export interface CrmAdapter {
  readonly name: string;
  init(): Promise<void>;
  handle(event: CallSofiaEvent, ctx: AdapterContext): Promise<HandlerResult>;
  healthCheck(): Promise<HealthStatus>;
}
```

Three methods, one shape:

- **`name`** — short string used in `CRM_ADAPTER` env, the registry switch, and `deliveries.handler_id`
- **`init()`** — called once when the adapter is first resolved; validate creds, prefetch metadata, throw on misconfiguration
- **`healthCheck()`** — surfaced at `/api/cron/health-check` so ops can detect a broken integration without sending traffic
- **`handle(event, ctx)`** — the workhorse; called once per event off the queue

The adapter must be **stateless across instances** — Vercel may instantiate multiple processes, and the registry caches one instance per process via `_cached`.

---

## Worked example: `LitifyAdapter`

The full [`src/lib/adapters/litify/adapter.ts`](../../src/lib/adapters/litify/adapter.ts) is a 160-line switch on `event_type`. The skeleton:

```typescript
export class LitifyAdapter implements CrmAdapter {
  readonly name = "litify";

  async init(): Promise<void> {
    await litifyAuth.getConnection();   // OAuth client-credentials token
  }

  async healthCheck(): Promise<HealthStatus> {
    const ok = await litifyAuth.ping();  // SELECT Id FROM User LIMIT 1
    return { healthy: ok, message: ok ? "ok" : "ping failed", timestamp: new Date() };
  }

  async handle(event: CallSofiaEvent, _ctx: AdapterContext): Promise<HandlerResult> {
    const p = event.data.payload as Record<string, unknown>;
    const callId = (p.call_id ?? p.room_name) as string | undefined;
    const phone = (p.caller_phone ?? p.from_phone) as string | undefined;

    try {
      switch (event.event_type) {
        case "call.ended": {
          if (!phone || !callId) return { outcome: "noop", message: "missing phone or call_id" };
          const person = await Person.upsertByPhone(phone, {});
          const intake = await Intake.createIntake({ personId: person.Id, callId, /* ... */ });
          return { outcome: "success", crm_record_id: intake.id };
        }
        // ... other events
        default:
          return { outcome: "noop", message: `no handler for ${event.event_type}` };
      }
    } catch (err) {
      const e = err as Error & { errorCode?: string };
      const retryable = !["INVALID_FIELD", "DUPLICATE_VALUE"].includes(e.errorCode ?? "");
      return {
        outcome: retryable ? "retry" : "failure",
        error: { code: e.errorCode ?? "unknown", message: e.message, retryable },
      };
    }
  }
}
```

Key lessons from the Litify implementation:

- **Defensive payload reads** — fields are read with explicit fallbacks (`p.call_id ?? p.room_name`) because the platform-api payload shape has evolved
- **Early `noop`** when required fields are missing — failing one event shouldn't dead-letter the rest
- **Per-error-code retry classification** — Salesforce's `INVALID_FIELD` is permanent (don't retry), but a network blip is transient (retry)
- **Sub-files for each concern** — `auth.ts`, `person.ts`, `intake.ts`, `activity.ts`, `recording.ts`, `field-mapping.ts`, `case-type-cache.ts`. Each has its own test file

---

## Step-by-step: scaffolding `hubspot/`

### 1. Create the folder

```
src/lib/adapters/hubspot/
├── adapter.ts          # implements CrmAdapter
├── adapter.test.ts
├── auth.ts             # private app token / OAuth refresh
├── contact.ts          # find-or-create HubSpot Contact
├── deal.ts             # create HubSpot Deal
└── field-mapping.ts    # CallSofia case_type → HubSpot dealtype
```

### 2. Implement the interface

```typescript
// src/lib/adapters/hubspot/adapter.ts
import type { CrmAdapter, AdapterContext, HandlerResult, HealthStatus } from "../types";
import type { CallSofiaEvent } from "@/lib/webhook/types";
import { hubspotClient } from "./auth";
import * as Contact from "./contact";
import * as Deal from "./deal";

export class HubSpotAdapter implements CrmAdapter {
  readonly name = "hubspot";

  async init(): Promise<void> {
    await hubspotClient.ping();           // throws if token is invalid
  }

  async healthCheck(): Promise<HealthStatus> {
    try {
      const portal = await hubspotClient.accountInfo();
      return { healthy: true, message: `portal ${portal.portalId}`, timestamp: new Date() };
    } catch (err) {
      return { healthy: false, message: (err as Error).message, timestamp: new Date() };
    }
  }

  async handle(event: CallSofiaEvent, _ctx: AdapterContext): Promise<HandlerResult> {
    const p = event.data.payload as Record<string, unknown>;
    const callId = p.call_id as string | undefined;
    const phone = (p.caller_phone_number ?? p.caller_phone) as string | undefined;

    try {
      switch (event.event_type) {
        case "lead.qualified": {
          if (!callId || !phone) return { outcome: "noop", message: "missing phone or call_id" };
          const contact = await Contact.upsertByPhone(phone, {
            firstname: (p.lead as { name?: string } | undefined)?.name,
          });
          const deal = await Deal.upsertByCallId(callId, {
            associatedContactId: contact.id,
            dealname: `CallSofia intake — ${p.case_type ?? "general"}`,
            amount: undefined,                         // unknown at qualification time
            callsofia_call_id: callId,                 // custom property, marked unique
            callsofia_summary: p.summary as string,
          });
          return {
            outcome: "success",
            crm_record_id: deal.id,
            crm_record_url: `https://app.hubspot.com/contacts/${contact.portalId}/deal/${deal.id}`,
            api_calls: 2,
          };
        }
        default:
          return { outcome: "noop", message: `no handler for ${event.event_type}` };
      }
    } catch (err) {
      const e = err as { code?: number; message: string };
      const retryable = e.code === undefined || e.code >= 500 || e.code === 429;
      return {
        outcome: retryable ? "retry" : "failure",
        error: { code: String(e.code ?? "unknown"), message: e.message, retryable },
      };
    }
  }
}
```

### 3. Add the env-var schema

Edit `src/lib/config.ts` to add a `hubspot` section under `ConfigSchema`. Mirror the pattern used by `salesforce`:

```typescript
hubspot: z.object({
  privateAppToken: z.string().min(1),
  portalId: z.string().optional(),
}).optional(),
```

Then add the actual env vars to `.env.example`:

```
HUBSPOT_PRIVATE_APP_TOKEN=
HUBSPOT_PORTAL_ID=
```

---

## Registering the adapter

Edit [`src/lib/adapters/registry.ts`](../../src/lib/adapters/registry.ts) in two places:

```typescript
// 1. Extend the union type
export type AdapterName = "litify" | "generic-webhook" | "hubspot" | "none";
const VALID_NAMES: AdapterName[] = ["litify", "generic-webhook", "hubspot", "none"];

// 2. Add a case in getAdapter()
case "hubspot": {
  const path = "./hubspot/adapter";
  const mod = (await import(/* @vite-ignore */ path)) as {
    HubSpotAdapter: new () => CrmAdapter;
  };
  _cached = new mod.HubSpotAdapter();
  break;
}
```

`selectAdapterName(process.env.CRM_ADAPTER)` will then accept `"hubspot"` and `getAdapter("hubspot")` will lazy-load and call `init()`.

---

## Test fixture pattern

Mirror [`src/lib/adapters/litify/adapter.test.ts`](../../src/lib/adapters/litify/adapter.test.ts). The repeating pattern:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { HubSpotAdapter } from "./adapter";
import * as Contact from "./contact";
import * as Deal from "./deal";

vi.mock("./auth", () => ({
  hubspotClient: {
    ping: vi.fn().mockResolvedValue(true),
    accountInfo: vi.fn().mockResolvedValue({ portalId: "12345" }),
  },
}));

describe("HubSpotAdapter", () => {
  let adapter: HubSpotAdapter;
  beforeEach(async () => {
    vi.restoreAllMocks();
    adapter = new HubSpotAdapter();
    await adapter.init();
  });

  it("creates Contact + Deal on lead.qualified", async () => {
    vi.spyOn(Contact, "upsertByPhone").mockResolvedValue({ id: "c1", portalId: "12345" } as never);
    vi.spyOn(Deal, "upsertByCallId").mockResolvedValue({ id: "d1" } as never);

    const result = await adapter.handle(
      {
        event_id: "f3a8c7d2-8b91-4e1f-9a7c-1a2b3c4d5e6f",
        event_type: "lead.qualified",
        emitted_at: "2026-04-30T17:00:00Z",
        schema_version: 2,
        data: {
          scope: { org_id: "x", workspace_id: "y", pipeline_id: "z", stage_id: null },
          payload: { call_id: "c-1", caller_phone_number: "+15551234567", lead: { name: "Jane" } },
        },
      },
      { platformApi: {} as never, config: {} },
    );

    expect(result.outcome).toBe("success");
    expect(result.crm_record_id).toBe("d1");
    expect(Deal.upsertByCallId).toHaveBeenCalledWith("c-1", expect.objectContaining({
      associatedContactId: "c1",
    }));
  });

  it("classifies 5xx as retry", async () => {
    vi.spyOn(Contact, "upsertByPhone").mockRejectedValue({ code: 503, message: "upstream" });
    const result = await adapter.handle(
      { /* ... */ } as never,
      { platformApi: {} as never, config: {} },
    );
    expect(result.outcome).toBe("retry");
    expect(result.error?.retryable).toBe(true);
  });

  it("classifies 4xx as failure", async () => {
    vi.spyOn(Contact, "upsertByPhone").mockRejectedValue({ code: 400, message: "bad data" });
    const result = await adapter.handle(/* ... */ as never, /* ... */);
    expect(result.outcome).toBe("failure");
  });

  it("returns noop for unhandled event types", async () => {
    const result = await adapter.handle(
      { event_type: "call.ringing" /* ... */ } as never,
      { platformApi: {} as never, config: {} },
    );
    expect(result.outcome).toBe("noop");
  });
});
```

Recommended coverage per adapter:

- ✅ One success test per `event_type` you handle
- ✅ Retry classification (transient → retry)
- ✅ Failure classification (validation → failure)
- ✅ Noop on missing required fields
- ✅ Noop on unhandled event types
- ✅ `init()` throws on missing config

---

## Idempotency contract

> **The same event can be re-delivered. Adapters MUST be safe under repeat delivery.**

The bridge already deduplicates at ingest via the `events` table primary key on `event_id`, so the consumer should never see the *same* `event_id` twice. But:

- **Retries with the same `event_id`** happen when the adapter returns `retry` — your `handle()` will be called again
- **Different `event_id`s for the same logical record** happen all the time (e.g. `call.ended` then `call.extracted` then `lead.qualified` for one call). Every event must converge on the same CRM record

The pattern: **upsert by an external ID, never `create`**. Examples:

| CRM | Idempotency mechanism |
| --- | --- |
| Salesforce / Litify | External ID custom field marked **Unique** + jsforce `upsert()` |
| HubSpot | Custom property marked Unique + `crm.objects.basic.upsert()` |
| Pipedrive | Custom field marked "Required & Unique" + manual find-then-update |
| Generic REST | `PUT /resources/{call_id}` (let the server own idempotency) |

In `LitifyAdapter`, `CallSofia_Call_ID__c` on `litify_pm__Intake__c` is the external ID; every event for the same `call_id` upserts the same Intake. Replicate this pattern in your adapter.

---

## Retry vs failure semantics

The consumer ([`src/app/api/queue/consumer/route.ts`](../../src/app/api/queue/consumer/route.ts)) takes the `outcome` you return and acts on it:

| Outcome | Meaning | Consumer action |
| --- | --- | --- |
| `success` | CRM write succeeded | Mark delivery `succeeded`, no retry |
| `noop` | Handler intentionally skipped (missing field, unhandled event type, disabled toggle) | Mark `noop`, no retry, **not** an error |
| `retry` | Transient failure — try again later | Schedule next attempt with exponential backoff up to `MAX_RETRIES`, then dead-letter |
| `failure` | Permanent failure — don't retry | Mark `failed`, no retry, log to platform-api as `bridge.handler_failed` |

The classification rule of thumb:

> **If retrying in 5 minutes might succeed, return `retry`. If it definitely won't, return `failure`.**

| Cause | Outcome |
| --- | --- |
| Network timeout, DNS failure, connection reset | `retry` |
| 5xx from CRM | `retry` |
| 429 rate-limited | `retry` |
| 401 / expired token (and your auth layer auto-refreshed and re-failed) | `failure` (creds are bad) |
| 401 / expired token (auto-refresh hasn't fired yet) | wrap in your auth layer, not the adapter |
| 4xx validation error (`INVALID_FIELD`, `DUPLICATE_VALUE`, schema mismatch) | `failure` |
| Required payload field missing | `noop` (better than `failure` — it isn't your CRM's fault) |
| Unhandled event type | `noop` |

If you're unsure, lean toward `retry` — dead-lettered events are visible in the admin dashboard and can be replayed manually, but a `failure` is silent.

---

## Outcome → `deliveries.status` mapping

Every adapter call produces one row in the `deliveries` table:

| `HandlerResult.outcome` | `deliveries.status` |
| --- | --- |
| `success` | `succeeded` |
| `noop` | `noop` |
| `retry` | `retrying` (if attempts remain) or `failed` (after dead-letter) |
| `failure` | `failed` |

Plus the consumer fires a corresponding `bridge.handler_*` activity log to platform-api so the same outcome shows up in the CallSofia dashboard's activity feed:

| Outcome | Activity log type | Severity |
| --- | --- | --- |
| `success` | `bridge.handler_succeeded` | `info` |
| `noop` | `bridge.handler_noop` | `info` |
| `retry` | `bridge.handler_retry_scheduled` | `info` |
| `failure` | `bridge.handler_failed` | `error` |
| dead-letter | `bridge.dead_letter` | `error` |

Set `MIRROR_TO_PLATFORM_API=false` to suppress the mirror calls (useful in self-hosted setups that don't talk back to CallSofia).

---

See also: [`docs/security.md`](../security.md) for the inbound HMAC scheme adapters can rely on, [`docs/integrations/litify.md`](litify.md) for the worked-example reference implementation, and [`docs/architecture.md`](../architecture.md) for how `handle()` fits into the queue/consumer/retry pipeline.
