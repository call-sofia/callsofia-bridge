import { NextResponse } from "next/server";
import { lte, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { publishEventForProcessing } from "@/lib/queue/publisher";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request): Promise<Response> {
  const now = new Date();
  const due = await db.select().from(schema.retryQueue).where(lte(schema.retryQueue.scheduledFor, now)).limit(50);
  for (const row of due) {
    void publishEventForProcessing(row.eventId, row.attempt);
    await db.delete(schema.retryQueue).where(eq(schema.retryQueue.id, row.id));
  }
  logger.info("cron_retries_processed", { count: due.length });
  return NextResponse.json({ ok: true, processed: due.length });
}
