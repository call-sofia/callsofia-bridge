import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { publishEventForProcessing } from "@/lib/queue/publisher";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ClaimedRow {
  id: number;
  event_id: string;
  attempt: number;
}

export async function GET(_req: Request): Promise<Response> {
  // Atomic claim: DELETE ... RETURNING with SKIP LOCKED so two concurrent crons
  // can never claim the same row. Without this, an overlapping tick would
  // re-publish a row another invocation has already published.
  const claimed = (await db.execute(sql`
    DELETE FROM retry_queue
    WHERE id IN (
      SELECT id FROM retry_queue
      WHERE scheduled_for <= NOW()
      ORDER BY scheduled_for
      LIMIT 50
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, event_id, attempt
  `)) as unknown as ClaimedRow[];

  for (const row of claimed) {
    void publishEventForProcessing(row.event_id, row.attempt);
  }

  logger.info("cron_retries_processed", { count: claimed.length });
  return NextResponse.json({ ok: true, processed: claimed.length });
}
