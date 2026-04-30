# Troubleshooting

## Webhooks return 401

- **Cause:** `CALLSOFIA_WEBHOOK_SECRET` doesn't match the secret configured in CallSofia dashboard
- **Fix:** Re-copy the secret from the CallSofia dashboard. Check for trailing whitespace.
- **Test locally:** `pnpm tsx scripts/dev/mock-callsofia.ts http://localhost:3000/api/webhooks/callsofia`

## Webhooks return 400 "Timestamp too old"

- Server clock skew. The bridge rejects timestamps older than 5 minutes (replay protection).
- Check NTP on the deployment if running outside Vercel.

## Litify: `INVALID_FIELD` error on insert

- A custom field expected by the bridge doesn't exist in your Salesforce org.
- **Fix:** Re-run `./scripts/litify/create-custom-fields.sh <org-alias>` to create any missing fields.
- See [`litify-setup-guide.md`](litify-setup-guide.md) for the full list of expected fields.

## Litify: 401 on every Salesforce call

- Session token expired or invalid credentials.
- **Cause 1:** Wrong `SALESFORCE_SECURITY_TOKEN` — reset it in the user's My Settings → Reset Security Token.
- **Cause 2:** IP restrictions on the Connected App — set "Relax IP restrictions" in policies.
- **Cause 3:** User profile changed.

## Events stuck in `retrying` status

- Check `/admin/failures` for the actual error message.
- For Salesforce 401: the next retry will refresh the token and likely succeed.
- For Salesforce 429 (rate limit): the cron job will pick it up after the rate-limit window.
- After 10 failed attempts, an event moves to `dead_letter` status. Use `/admin/replay` to manually retry.

## Duplicate Intake records appearing

- Should not happen — `CallSofia_Call_ID__c` is configured as External ID + Unique.
- **Check:** In Setup → Object Manager → Intake → Fields, confirm `CallSofia_Call_ID__c` has both `External ID` AND `Unique` flags set.
- If your script created the field without those flags, edit the field manually or re-create via `sf` CLI.

## Bridge can't reach CallSofia API

- Check `MIRROR_TO_PLATFORM_API` is `true` (or unset; default is true).
- Verify `CALLSOFIA_API_KEY` is correct (Stripe-style format `sk_<env>_<org>_<random>`).
- Test: `curl -H "X-API-Key: $CALLSOFIA_API_KEY" $CALLSOFIA_API_BASE_URL/v1/health`

## Admin pages return 401

- `ADMIN_PASSWORD` env var not set, or browser cached old credentials.
- **Fix:** Set in Vercel → Settings → Environment Variables → `ADMIN_PASSWORD`. Redeploy.
- Browser auth: open in incognito or clear basic-auth cache.

## Database migration fails on deploy

- **Cause:** `DATABASE_URL` not set or unreachable during build.
- Check the Vercel build log for the exact `drizzle-kit migrate` error.
- For Neon: ensure the database branch is not paused.
