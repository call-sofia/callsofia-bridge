#!/usr/bin/env node
// Hand-crafted, properly-signed test webhook for any running bridge instance.
//
// Usage:
//   node scripts/dev/send-test-webhook.mjs [--url URL] [--event TYPE] [--secret SECRET]
//
// Defaults:
//   --url     http://localhost:3000
//   --event   call.ended
//   --secret  $CALLSOFIA_WEBHOOK_SECRET, else read from .env.local
//
// Prints status + response body + the event_id so you can grep the bridge DB.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

function arg(name, dflt) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : dflt;
}

function readSecretFromEnvFile() {
  const candidates = [".env.local", ".env"];
  for (const f of candidates) {
    if (!fs.existsSync(f)) continue;
    const m = fs.readFileSync(f, "utf-8").match(/^CALLSOFIA_WEBHOOK_SECRET=(.+)$/m);
    if (m) return m[1].trim().replace(/^["']|["']$/g, "");
  }
  return null;
}

const url = arg("url", "http://localhost:3000");
const eventType = arg("event", "call.ended");
const secret =
  arg("secret", null) ??
  process.env.CALLSOFIA_WEBHOOK_SECRET ??
  readSecretFromEnvFile();

if (!secret) {
  console.error(
    "ERR: no webhook secret found. Set CALLSOFIA_WEBHOOK_SECRET, pass --secret, or put it in .env.local",
  );
  process.exit(1);
}

const eventId = crypto.randomUUID();
const envelope = {
  event_id: eventId,
  event_type: eventType,
  emitted_at: new Date().toISOString(),
  schema_version: 1,
  data: {
    person: { phone: "+15555550100" },
    call_id: `test-${Date.now()}`,
    case_type: "car_accident",
    extracted_vars: {
      pnc_full_name: "Test Caller",
      incident_detailed_narrative: "Probe payload from send-test-webhook.mjs",
      injuries_claimed: "Minor neck strain",
      _probe: true,
    },
  },
};

const body = Buffer.from(JSON.stringify(envelope), "utf-8");
const ts = String(Math.floor(Date.now() / 1000));
const signingString = Buffer.concat([Buffer.from(ts, "utf-8"), Buffer.from("."), body]);
const sig =
  "sha256=" +
  crypto.createHmac("sha256", secret).update(signingString).digest("hex");

const target = `${url.replace(/\/$/, "")}/api/webhooks/callsofia`;
console.log(`POST ${target}`);
console.log(`  event_id   = ${eventId}`);
console.log(`  event_type = ${eventType}`);

const res = await fetch(target, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-CallSofia-Event": eventType,
    "X-CallSofia-Delivery": crypto.randomUUID(),
    "X-CallSofia-Timestamp": ts,
    "X-CallSofia-Signature": sig,
  },
  body,
});
const text = await res.text();
console.log(`  → ${res.status} ${text}`);
process.exit(res.ok ? 0 : 1);
