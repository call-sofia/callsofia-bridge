/**
 * Local mock CallSofia webhook sender.
 *
 * Replays canned events to your bridge for local development.
 *
 * Usage:
 *   pnpm tsx scripts/dev/mock-callsofia.ts http://localhost:3000/api/webhooks/callsofia
 *
 * Reads payloads from a sibling fixtures directory (see PAYLOAD_DIR below).
 * If you've cloned `callsofia-webhooks-docs` next to this repo, payloads will
 * resolve automatically. Otherwise pass --fixtures-dir <path>.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const target = process.argv[2] ?? "http://localhost:3000/api/webhooks/callsofia";
const secret = process.env.CALLSOFIA_WEBHOOK_SECRET ?? "whsec_dev";

const FIXTURE_FILES = [
  "call.ringing.json",
  "call.answered.json",
  "call.in_progress.json",
  "call.ended.json",
  "call.extracted.json",
  "lead.qualified.json",
  "evaluation.complete.json",
];

function findFixturesDir(): string {
  const cliFlag = process.argv.find((a) => a.startsWith("--fixtures-dir="));
  if (cliFlag) return cliFlag.split("=", 2)[1];
  const candidates = [
    path.resolve("../callsofia-webhooks-docs/examples/payloads"),
    path.resolve("../../callsofia-webhooks-docs/examples/payloads"),
    path.resolve("./examples/payloads"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  throw new Error(
    "Cannot locate fixtures dir. Pass --fixtures-dir=<path> or clone callsofia-webhooks-docs next to this repo."
  );
}

async function send(payloadPath: string): Promise<void> {
  const body = fs.readFileSync(payloadPath, "utf-8");
  const ts = new Date().toISOString();
  const sig =
    "sha256=" +
    crypto.createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex");

  const eventType = JSON.parse(body).event_type as string;
  const res = await fetch(target, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-callsofia-timestamp": ts,
      "x-callsofia-signature": sig,
      "x-callsofia-event": eventType,
      "x-callsofia-delivery": crypto.randomUUID(),
    },
    body,
  });
  console.log(`${path.basename(payloadPath)} → ${res.status}`);
}

async function main(): Promise<void> {
  const fixtureDir = findFixturesDir();
  console.log(`Using fixtures from: ${fixtureDir}`);
  console.log(`Posting to: ${target}\n`);

  for (const f of FIXTURE_FILES) {
    const p = path.join(fixtureDir, f);
    if (!fs.existsSync(p)) {
      console.warn(`  missing: ${p}`);
      continue;
    }
    await send(p);
    await new Promise((r) => setTimeout(r, 300));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
