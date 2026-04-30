# Adding a New CRM Adapter

The bridge uses a pluggable adapter pattern. Adding a new CRM (Filevine, MyCase, HubSpot, etc.) is a single-file change.

## 1. Create the adapter folder

```
src/lib/adapters/<crm-name>/
  ├── adapter.ts         # main entry implementing CrmAdapter
  ├── adapter.test.ts
  └── (auth.ts, *.ts as needed)
```

## 2. Implement the interface

```typescript
import type { CrmAdapter, AdapterContext, HandlerResult, HealthStatus } from "../types";
import type { CallSofiaEvent } from "@/lib/webhook/types";

export class HubSpotAdapter implements CrmAdapter {
  readonly name = "hubspot";

  async init(): Promise<void> {
    // validate creds, fetch portal info, etc.
  }

  async healthCheck(): Promise<HealthStatus> {
    // ping CRM API
    return { healthy: true, timestamp: new Date() };
  }

  async handle(event: CallSofiaEvent, ctx: AdapterContext): Promise<HandlerResult> {
    switch (event.event_type) {
      case "lead.qualified": {
        // create HubSpot Contact + Deal
        return { outcome: "success", crm_record_id: "deal-123" };
      }
      default:
        return { outcome: "noop" };
    }
  }
}
```

## 3. Register in the adapter registry

Edit `src/lib/adapters/registry.ts`:

```typescript
case "hubspot": {
  const { HubSpotAdapter } = await import("./hubspot/adapter");
  _cached = new HubSpotAdapter();
  break;
}
```

Also extend the `AdapterName` type and `VALID_NAMES` array.

## 4. Add the env var schema

Edit `src/lib/config.ts` to add a `hubspot` section under `ConfigSchema`. Mirror the pattern used by `salesforce`.

## 5. Tests

Mirror the pattern from `litify/adapter.test.ts`:
- Mock the SDK (or `fetch` if using REST directly)
- Test each `event_type` switch case
- Test error mapping (which errors are `retry` vs `failure`)

## 6. Configure and deploy

Set `CRM_ADAPTER=hubspot` (and the new HubSpot env vars) in your Vercel deployment. Push to main.

## Tips

- **Idempotency:** Use the CRM's external ID feature (Salesforce External ID, HubSpot Custom Properties marked unique) to make all writes upserts keyed on `event.event_id` or `payload.call_id`.
- **Retries:** Map provider error codes to `retry` (5xx, 429) vs `failure` (4xx other) so the consumer's retry logic does the right thing.
- **Auth caching:** OAuth tokens should be cached in Redis with a TTL just under the token's lifetime to avoid stampedes.
