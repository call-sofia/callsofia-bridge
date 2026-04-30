# Litify Setup Guide

This guide walks through configuring your Salesforce + Litify org to receive CallSofia events through the bridge.

## Prerequisites

- Salesforce org with Litify managed package installed
- System Administrator access to that org
- `sf` CLI installed: `npm i -g @salesforce/cli`
- Node.js 18+ on the machine running the setup script

## Step 1 — Create a Connected App

This is the OAuth client the bridge uses to authenticate against Salesforce.

1. Salesforce Setup → **App Manager** → **New Connected App**
2. **Basic Information:**
   - Connected App Name: `CallSofia Bridge`
   - API Name: `CallSofia_Bridge`
   - Contact Email: your admin email
3. **API (Enable OAuth Settings):** check the box, then:
   - Callback URL: `https://login.salesforce.com/services/oauth2/success`
   - Selected OAuth Scopes:
     - `Manage user data via APIs (api)`
     - `Perform requests at any time (refresh_token, offline_access)`
4. Save. Wait ~10 minutes for Salesforce to propagate the app.
5. Note the **Consumer Key** → this is your `SALESFORCE_CLIENT_ID`
6. Click **Click to reveal** on Consumer Secret → this is your `SALESFORCE_CLIENT_SECRET`

### Configure policies

1. App Manager → CallSofia Bridge → **Manage** → **Edit Policies**
2. Permitted Users: **Admin approved users are pre-authorized**
3. IP Relaxation: **Relax IP restrictions** (the bridge runs on Vercel — IPs vary)
4. Save.

### Pre-authorize the integration user

1. App Manager → CallSofia Bridge → Manage → **Profiles** → Manage Profiles
2. Add the profile of the user the bridge will authenticate as (e.g. "Integration User", or System Administrator)

### Reset the integration user's security token

1. Log in as the integration user → **Settings** → **Reset My Security Token**
2. Check email for the new token
3. This is your `SALESFORCE_SECURITY_TOKEN`

## Step 2 — Create CallSofia custom fields

```bash
sf org login web --instance-url https://login.salesforce.com -a acme-litify
./scripts/litify/create-custom-fields.sh acme-litify
```

This creates 14 custom fields on `litify_pm__Intake__c` and 2 on `Task`. See `scripts/litify/fields.json` for the full list.

### Verify

In Setup → Object Manager → **Intake** → Fields:

- All `CallSofia_*__c` fields should be present
- `CallSofia_Call_ID__c` must show **External ID** ✓ and **Unique** ✓ (this is the idempotency key — without these flags you'll get duplicate intakes on retries)

If anything is missing, edit the field manually in Setup or re-run the script.

## Step 3 — Configure intake defaults

Find user IDs to use as defaults:

```bash
# Default intake owner
sf data query --query "SELECT Id, Name FROM User WHERE Username = 'intake@yourfirm.com'" --target-org acme-litify

# Intake coordinator (gets assigned 'needs review' intakes)
sf data query --query "SELECT Id, Name FROM User WHERE Profile.Name = 'Intake Coordinator'" --target-org acme-litify
```

Set in your Vercel env:
- `INTAKE_DEFAULT_OWNER_ID` — User ID for `OwnerId` on new intakes
- `INTAKE_COORDINATOR_USER_ID` — User ID assigned when status flips to `needs_review`

If you use Litify Record Types for Intake:

```bash
sf data query --query "SELECT Id, Name, DeveloperName FROM RecordType WHERE SobjectType = 'litify_pm__Intake__c'" --target-org acme-litify
```

Set `LITIFY_INTAKE_RECORD_TYPE_ID` to the matching ID.

## Step 4 — Verify Case Type records

The bridge maps CallSofia case types to Litify `litify_pm__Case_Type__c` records by Name. The mapping in `src/lib/adapters/litify/field-mapping.ts` is:

| CallSofia | Litify Case Type Name |
|---|---|
| `workers_comp` | Workers' Compensation |
| `auto_accident` | Auto Accident |
| `slip_and_fall` | Premises Liability |
| `premises_liability` | Premises Liability |
| `medical_malpractice` | Medical Malpractice |
| `product_liability` | Product Liability |
| `wrongful_death` | Wrongful Death |
| `general_injury` | General Personal Injury |

Check that each name exists in your org:

```bash
sf data query --query "SELECT Id, Name FROM litify_pm__Case_Type__c" --target-org acme-litify
```

If your firm uses different names (e.g. "Workers Compensation" without the apostrophe), either:
1. Adjust the picklist values / record names in your org to match the table above, or
2. Edit `CASE_TYPE_TO_LITIFY` in `src/lib/adapters/litify/field-mapping.ts` and redeploy

## Step 5 — End-to-end test

```bash
cd /path/to/callsofia-bridge
pnpm dev   # http://localhost:3000

# In another terminal:
pnpm tsx scripts/dev/mock-callsofia.ts http://localhost:3000/api/webhooks/callsofia
```

In Salesforce, you should now see:
- A new `litify_pm__Person__c` record matching the test caller phone
- A new `litify_pm__Intake__c` record linked to that person, with all `CallSofia_*__c` fields populated
- A `Task` (Activity) of type "Call" with `CallSofia_Call_ID__c` matching the test event

## Auto-conversion to Matter

Litify intakes can be promoted to a `litify_pm__Matter__c` (an actual case file). The bridge can do this automatically when a `lead.qualified` event arrives:

- `LITIFY_AUTO_CONVERT_QUALIFIED=false` (default) → status set to "Qualified", a human reviews and clicks Convert in Litify
- `LITIFY_AUTO_CONVERT_QUALIFIED=true` → bridge invokes Litify's intake-to-matter Flow programmatically

Most firms keep this OFF until they trust the AI's qualification accuracy. Enable in env vars when ready.

## Field Reference

The complete field-by-event mapping is in `src/lib/adapters/litify/adapter.ts`. Summary:

| CallSofia Event | Litify Operation |
|---|---|
| `call.ringing` | If person exists by phone, create Task (Activity) "Inbound Call" |
| `call.ended` | Find/create Person, create Intake with full call metadata |
| `call.extracted` | Update Intake with extracted intake fields (incident date, injury, employer, etc.) |
| `lead.qualified` | Set Intake status to "Qualified" + Quality Score; optionally trigger Matter conversion |
| `lead.needs_review` | Set Intake status to "Needs Review" + assign to coordinator |
| `evaluation.complete` | Update Intake with AI Quality Score (0-100) |
| `recording.ogg` | Upload audio as ContentVersion linked to Intake |
| `call.transferred` / `call.transfer_failed` | Append note to Task |

## Troubleshooting

See [`troubleshooting.md`](troubleshooting.md) for common issues.
