#!/usr/bin/env bash
set -euo pipefail

# Usage:
#   sf org login web --instance-url https://login.salesforce.com -a my-org
#   ./scripts/litify/create-custom-fields.sh my-org

ORG="${1:-default}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if ! command -v sf >/dev/null 2>&1; then
  echo "Error: 'sf' CLI not found. Install with: npm i -g @salesforce/cli"
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Error: 'node' not found"
  exit 1
fi

echo "Creating CallSofia custom fields in '$ORG'..."

node - "$SCRIPT_DIR" "$ORG" <<'JS'
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const [, , scriptDir, org] = process.argv;
const fields = JSON.parse(fs.readFileSync(path.join(scriptDir, "fields.json"), "utf-8"));

let created = 0;
let skipped = 0;
for (const [obj, defs] of Object.entries(fields.objects)) {
  for (const f of defs) {
    const cmd = [
      "sf schema create field",
      "--object", obj,
      "--name", f.fullName,
      "--label", JSON.stringify(f.label),
      "--type", f.type,
      f.length ? `--length ${f.length}` : "",
      f.precision ? `--precision ${f.precision}` : "",
      f.scale != null ? `--scale ${f.scale}` : "",
      f.externalId ? "--external-id" : "",
      f.unique ? "--unique" : "",
      "--target-org", org,
    ].filter(Boolean).join(" ");
    process.stdout.write(`+ ${obj}.${f.fullName} ... `);
    try {
      execSync(cmd, { stdio: "pipe" });
      console.log("created");
      created++;
    } catch (e) {
      console.log("skipped (may already exist)");
      skipped++;
    }
  }
}
console.log(`\nDone. Created ${created}, skipped ${skipped}.`);
console.log(`Verify in Setup → Object Manager → Intake → Fields.`);
JS
