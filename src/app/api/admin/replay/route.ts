import { NextResponse } from "next/server";
import { and, eq, gte, lte } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { publishEventForProcessing } from "@/lib/queue/publisher";

export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  const url = new URL(req.url);

  // Single-event replay via query param
  const single = url.searchParams.get("event_id");
  if (single) {
    await publishEventForProcessing(single, 1);
    return NextResponse.redirect(new URL("/admin/failures", url), 302);
  }

  // Bulk replay via form fields
  const form = await req.formData();
  const eventType = form.get("event_type") as string | null;
  const from = form.get("from") as string | null;
  const to = form.get("to") as string | null;

  const where = and(
    eventType ? eq(schema.events.eventType, eventType) : undefined,
    from ? gte(schema.events.emittedAt, new Date(from)) : undefined,
    to ? lte(schema.events.emittedAt, new Date(to)) : undefined,
  );

  const matches = await db.select({ eventId: schema.events.eventId }).from(schema.events).where(where);
  for (const m of matches) await publishEventForProcessing(m.eventId, 1);

  return NextResponse.json({ requeued: matches.length });
}
