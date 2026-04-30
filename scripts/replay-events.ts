/**
 * Bulk replay events from production Postgres back through the queue.
 *
 * Usage:
 *   DATABASE_URL=... pnpm tsx scripts/replay-events.ts \
 *     --event-type lead.qualified \
 *     --from 2026-04-29T00:00:00Z \
 *     --to 2026-04-29T23:59:59Z
 *
 * Either --event-type or both --from/--to can be omitted (no filter on that dim).
 */
import { and, eq, gte, lte } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { publishEventForProcessing } from "@/lib/queue/publisher";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

async function main(): Promise<void> {
  const eventType = arg("event-type");
  const from = arg("from");
  const to = arg("to");

  const where = and(
    eventType ? eq(schema.events.eventType, eventType) : undefined,
    from ? gte(schema.events.emittedAt, new Date(from)) : undefined,
    to ? lte(schema.events.emittedAt, new Date(to)) : undefined,
  );

  const rows = await db.select({ eventId: schema.events.eventId }).from(schema.events).where(where);
  console.log(`Re-publishing ${rows.length} events…`);
  for (const r of rows) await publishEventForProcessing(r.eventId, 1);
  console.log("Done.");
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
