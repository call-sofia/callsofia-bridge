# Litify (Salesforce) Integration

The Litify adapter is the bridge's flagship CRM integration: it forwards CallSofia voice-intake events into a Salesforce org running the [Litify](https://www.litify.com/) managed package, creating `litify_pm__Person__c` and `litify_pm__Intake__c` records, attaching call recordings, and (optionally) triggering Litify's intake-to-matter conversion flow.

## Table of Contents

- [How it works](#how-it-works)
- [Salesforce setup (one time)](#salesforce-setup-one-time)
- [Custom fields](#custom-fields)
- [Environment variables](#environment-variables)
- [Recording mode: `url` vs `attach`](#recording-mode-url-vs-attach)
- [End-to-end payload example](#end-to-end-payload-example)
- [Event → Salesforce operation matrix](#event--salesforce-operation-matrix)
- [Troubleshooting](#troubleshooting)
- [Known issue: `Phone` vs `litify_pm__Phone__c`](#known-issue-phone-vs-litify_pm__phone__c)

---

## How it works

```
CallSofia → POST /api/webhooks/callsofia (HMAC verified, deduped by event_id)
                          ↓
                    events table (Postgres)
                          ↓
                    queue/consumer → LitifyAdapter.handle()
                          ↓
                    jsforce → Salesforce REST/SOAP
                          ↓
                    Person → Intake → Activity → ContentVersion
                          ↓
                    deliveries table + bridge.handler_* activity log
```

The adapter authenticates with the **OAuth 2.0 Client Credentials Flow** against `${SALESFORCE_LOGIN_URL}/services/oauth2/token`. The acquired access token is cached in memory for ~60 minutes (soft TTL); a `401` / `INVALID_SESSION_ID` from any data-path call triggers a one-shot refresh via `withFreshConnection()` (`src/lib/adapters/litify/auth.ts`).

---

## Salesforce setup (one time)

### 1. Enable the Client Credentials Flow

Salesforce Setup → **OAuth and OpenID Connect Settings** → enable **Allow OAuth Username-Password Flows**? **No.** You want **Client Credentials Flow** instead — it's the recommended server-to-server flow for managed integrations and the only one this adapter supports.

### 2. Create the Connected App

Setup → **App Manager** → **New Connected App**:

| Field | Value |
| --- | --- |
| Connected App Name | `CallSofia Bridge` |
| API Name | `CallSofia_Bridge` |
| Contact Email | your admin email |
| Enable OAuth Settings | ✅ |
| Callback URL | `https://login.salesforce.com/services/oauth2/success` (placeholder; client-credentials doesn't redirect) |
| Selected OAuth Scopes | `Manage user data via APIs (api)` (Client Credentials Flow does not issue refresh tokens, so `refresh_token, offline_access` is unnecessary) |
| Enable Client Credentials Flow | ✅ |
| Run As | a dedicated **Integration User** (license: Salesforce / Litify Pro) |

Save and wait ~10 minutes for Salesforce to propagate the app.

### 3. Configure policies

Manage → Edit Policies:

- **Permitted Users:** Admin approved users are pre-authorized
- **IP Relaxation:** Relax IP restrictions (the bridge runs on Vercel — IPs vary)

Manage → Profiles → add the run-as user's profile.

### 4. Capture credentials

- **Consumer Key** → `SALESFORCE_CLIENT_ID`
- **Consumer Secret** (click "Click to reveal") → `SALESFORCE_CLIENT_SECRET`
- **Login URL** → `SALESFORCE_LOGIN_URL` (`https://login.salesforce.com` for prod, `https://test.salesforce.com` for sandbox, or your My Domain URL)

> The legacy `SALESFORCE_USERNAME` / `SALESFORCE_PASSWORD` / `SALESFORCE_SECURITY_TOKEN` env vars are still accepted by the zod schema but the adapter **never uses them** to authenticate — they're only read in [`auth.ts`](../../src/lib/adapters/litify/auth.ts) `refresh()` to emit a `litify_auth_legacy_credentials_ignored` deprecation warning when set. The adapter authenticates exclusively via OAuth Client Credentials Flow. Remove these env vars once you've confirmed OAuth is working.

---

## Custom fields

The adapter requires the following custom fields. Create them with the helper script:

```bash
sf org login web --instance-url https://login.salesforce.com -a my-litify
./scripts/litify/create-custom-fields.sh my-litify
```

The script reads `scripts/litify/fields.json` and creates 14 fields on `litify_pm__Intake__c` and 2 on `Task`.

### `litify_pm__Intake__c`

| Field | Type | Notes |
| --- | --- | --- |
| `CallSofia_Call_ID__c` | Text(36) | **External ID + Unique** — the idempotency key |
| `CallSofia_Twilio_SID__c` | Text(50) | |
| `CallSofia_Language__c` | Picklist | `en`, `es`, `hi` |
| `CallSofia_Case_Type__c` | Text(80) | |
| `CallSofia_Summary__c` | Long Text Area (32768) | AI-generated summary |
| `CallSofia_Last_Synced_At__c` | DateTime | |
| `CallSofia_Recording_URL__c` | URL | |
| `CallSofia_Quality_Score__c` | Number(3,0) | 0–100 |
| `CallSofia_Event_ID__c` | Text(36) | last event applied |
| `CallSofia_Incident_Date__c` | Date | from `extracted_vars` |
| `CallSofia_Injury_Type__c` | Text(255) | from `extracted_vars` |
| `CallSofia_Employer_Name__c` | Text(255) | from `extracted_vars` |
| `CallSofia_Medical_Treatment__c` | Text(100) | from `extracted_vars` |
| `CallSofia_Prior_Attorney__c` | Checkbox | from `extracted_vars` |

> ⚠️ `CallSofia_Call_ID__c` **must** have both **External ID** ✓ and **Unique** ✓. Without these flags every retry creates a duplicate Intake. After running the script, verify in Setup → Object Manager → Intake → Fields.

### `Task`

| Field | Type | Notes |
| --- | --- | --- |
| `CallSofia_Call_ID__c` | Text(36) | External ID |
| `CallSofia_Twilio_SID__c` | Text(50) | |

---

## Environment variables

Required (✅) and optional (⚙️). Full reference in [`.env.example`](../../.env.example).

| Var | Required | Example | Purpose |
| --- | --- | --- | --- |
| `CRM_ADAPTER` | ✅ | `litify` | Selects this adapter |
| `SALESFORCE_LOGIN_URL` | ✅ | `https://login.salesforce.com` | Token endpoint base. Use `https://test.salesforce.com` for sandboxes |
| `SALESFORCE_CLIENT_ID` | ✅ | `3MVG9...` | Consumer Key |
| `SALESFORCE_CLIENT_SECRET` | ✅ | `<consumer-secret>` | Consumer Secret (the long opaque string revealed by Salesforce; no fixed prefix) |
| `INTAKE_DEFAULT_OWNER_ID` | ⚙️ | `0058...` | `OwnerId` for new Intakes; defaults to the run-as user |
| `INTAKE_COORDINATOR_USER_ID` | ⚙️ | `0058...` | `OwnerId` reassignment when status flips to `needs_review` |
| `LITIFY_INTAKE_RECORD_TYPE_ID` | ⚙️ | `0125...` | If your org uses Intake record types |
| `LITIFY_RECORDING_MODE` | ⚙️ | `url` (default) or `attach` | See below |
| `LITIFY_AUTO_CONVERT_QUALIFIED` | ⚙️ | `false` (default) | If `true`, `lead.qualified` triggers Litify's intake-to-matter Flow |
| `HANDLE_CALL_RINGING`, `HANDLE_CALL_ENDED`, … | ⚙️ | `true` | Per-event toggles; see `.env.example` |
| `SALESFORCE_USERNAME` / `_PASSWORD` / `_SECURITY_TOKEN` | ❌ deprecated | — | Read only to emit a one-shot `litify_auth_legacy_credentials_ignored` warning (see [`src/lib/adapters/litify/auth.ts`](../../src/lib/adapters/litify/auth.ts) `refresh()`); never used to authenticate. The adapter only supports OAuth Client Credentials Flow. Remove these once you've confirmed OAuth is working. |

To find user / record-type IDs:

```bash
sf data query --query "SELECT Id, Name FROM User WHERE Username = 'intake@yourfirm.com'" --target-org my-litify
sf data query --query "SELECT Id, Name FROM RecordType WHERE SobjectType = 'litify_pm__Intake__c'" --target-org my-litify
```

---

## Recording mode: `url` vs `attach`

CallSofia emits a `recording.ogg` event with a presigned S3 download URL for the call audio.

| Mode | Behavior | ✅ Pros | ❌ Cons |
| --- | --- | --- | --- |
| `url` (default) | Stores the presigned URL on `Intake.CallSofia_Recording_URL__c` | Cheap, no Salesforce storage usage, fast | URL expires in N days; offline copy not in Salesforce |
| `attach` | Downloads the OGG, uploads as a Salesforce `ContentVersion`, links to the Intake | Self-contained; survives URL expiry; searchable | Pulls bytes through the Vercel function (OOM risk on calls >25 MB); counts against Salesforce file storage |

Most firms start with `url` and only switch to `attach` once they've confirmed call audio sizes and storage budget. The implementation lives in `src/lib/adapters/litify/recording.ts`.

---

## End-to-end payload example

A `call.ended` event from CallSofia results in roughly these Salesforce records:

**`litify_pm__Person__c` (created or matched by phone):**

```json
{
  "Id": "a0X5g00000XYZab",
  "Name": "Doe",
  "litify_pm__First_Name__c": null,
  "litify_pm__Last_Name__c": "Unknown",
  "Phone": "+15551234567"
}
```

**`litify_pm__Intake__c` (created):**

```json
{
  "Id": "a015g00000ABCdef",
  "litify_pm__Client__c": "a0X5g00000XYZab",
  "OwnerId": "0055g00000DefGhi",
  "litify_pm__Status__c": "Open",
  "CallSofia_Call_ID__c": "f3a8c7d2-8b91-4e1f-9a7c-1a2b3c4d5e6f",
  "CallSofia_Twilio_SID__c": "CA1234567890abcdef1234567890abcdef",
  "CallSofia_Language__c": "en",
  "CallSofia_Case_Type__c": "auto_accident",
  "CallSofia_Summary__c": "Caller was rear-ended on the I-405 ...",
  "CallSofia_Last_Synced_At__c": "2026-04-30T17:43:21Z"
}
```

**`Task` (created):**

```json
{
  "Id": "00T5g00000XYZ123",
  "WhatId": "a015g00000ABCdef",
  "Subject": "CallSofia Call (210s)",
  "Status": "Completed",
  "CallSofia_Call_ID__c": "f3a8c7d2-...",
  "CallSofia_Twilio_SID__c": "CA1234..."
}
```

**`ContentVersion`** (only in `LITIFY_RECORDING_MODE=attach`):

```json
{
  "Id": "0685g00000RecOgg",
  "Title": "CallSofia recording f3a8c7d2",
  "PathOnClient": "f3a8c7d2.ogg",
  "FirstPublishLocationId": "a015g00000ABCdef"
}
```

---

## Event → Salesforce operation matrix

The full mapping lives in [`src/lib/adapters/litify/adapter.ts`](../../src/lib/adapters/litify/adapter.ts). Summary:

| CallSofia event | Litify operation |
| --- | --- |
| `call.ringing` | If a Person matches the phone, create a `Task` (Activity) "Inbound Call" |
| `call.completed` / `call.ended` | Find/create Person, create Intake with full call metadata, create completion Task |
| `call.processed` / `call.extracted` | Upsert Intake fields from `extracted_vars` (incident date, injury, employer, …) |
| `lead.qualified` | Set `litify_pm__Status__c="Qualified"` + `CallSofia_Quality_Score__c`; optionally invoke conversion Flow |
| `lead.needs_review` | Set status to `Needs Review`, reassign `OwnerId` to coordinator |
| `evaluation.complete` | Update `CallSofia_Quality_Score__c`; append note Activity with summary |
| `recording.ogg` | Attach recording per `LITIFY_RECORDING_MODE` |
| `call.transferred` / `call.transfer_failed` | Append note to the call Task |

Every other event type returns `noop` from the adapter and lands in `deliveries.status = 'noop'`.

---

## Troubleshooting

### `INVALID_SESSION_ID`

The cached access token expired earlier than the 60-min soft TTL (the connected app's session policy is shorter than that). The adapter automatically refreshes via `withFreshConnection()` and retries once. If you see this in logs without a successful retry, the OAuth credentials themselves are invalid — check `SALESFORCE_CLIENT_ID` / `SALESFORCE_CLIENT_SECRET` and that the connected app has Client Credentials Flow enabled with a valid run-as user.

### `INVALID_FIELD: No such column 'CallSofia_Foo__c'`

The custom field is missing from the org. Re-run `./scripts/litify/create-custom-fields.sh <alias>` and re-check Setup → Object Manager.

### `MISSING_TOKEN` / `400 invalid_client`

OAuth token exchange failed before the adapter even called Salesforce. Three causes:

1. The connected app hasn't propagated yet (~10 min after creation)
2. Wrong `SALESFORCE_LOGIN_URL` (sandbox vs prod, or My Domain not used)
3. Run-as user is inactive or has no Salesforce license

### `REQUEST_LIMIT_EXCEEDED` / 429 throttling

Salesforce daily API limit hit. Two fixes:

- **Disable noisy events** — set `HANDLE_CALL_RINGING=false` and `HANDLE_CALL_ANSWERED=false`; for most firms only `call.ended`, `call.extracted`, `lead.*`, `evaluation.complete`, and `recording.ogg` add real value
- **Increase the SF API allotment** — Salesforce sells extra API blocks; contact your AE

### Duplicate Intakes appear

`CallSofia_Call_ID__c` doesn't have both **External ID** and **Unique** set. Fix the field in Setup, then run `sf data query` to manually merge or delete the duplicates.

### Person rows aren't matching

You're probably hitting [the `Phone` issue](#known-issue-phone-vs-litify_pm__phone__c) below.

---

## Known issue: `Phone` vs `litify_pm__Phone__c`

> 🚧 **TODO before any prod customer onboarding.**

The current implementation in `src/lib/adapters/litify/person.ts` queries Litify Persons by the standard `Phone` field:

```typescript
.findOne<LitifyPerson>({ Phone: phone }, ["Id", "Name", "Phone"])
```

`Phone` is a **standard** Salesforce field that does **not** exist on Litify custom objects (`__c` suffix) by default — Litify uses `litify_pm__Phone__c`. In a real Litify org this either:

- silently returns 0 rows from `findByPhone` (causing duplicate person creation on every call), **or**
- throws `INVALID_FIELD` immediately

The pre-existing tests mock `findOne` and never hit a real SOQL serializer, so this slipped through. **Verify the actual phone field on each customer's Litify package** and switch both the `findByPhone` query and the `create()` payload before going live. The TODO is also flagged inline in `person.ts:14-23`.

---

See [`docs/security.md`](../security.md) for HMAC details, [`docs/integrations/custom-adapter.md`](custom-adapter.md) to build a different CRM integration, and [`docs/integrations/generic-webhook.md`](generic-webhook.md) if you'd rather forward to Make.com / Zapier / n8n than write Salesforce code.
