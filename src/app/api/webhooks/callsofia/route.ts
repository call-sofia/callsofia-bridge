import { NextResponse } from "next/server";
import { config } from "@/lib/config";
import { verifySignature, isTimestampFresh } from "@/lib/webhook/verify";
import { parseEnvelope } from "@/lib/webhook/envelope";
import { db, schema } from "@/lib/db/client";
import { publishEventForProcessing } from "@/lib/queue/publisher";
import { platformApi } from "@/lib/platform-api/client";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  const cfg = config();
  const rawBody = Buffer.from(await req.arrayBuffer());
  const signature = req.headers.get("x-callsofia-signature") ?? "";
  const timestamp = req.headers.get("x-callsofia-timestamp") ?? "";

  if (!verifySignature(cfg.callsofia.webhookSecret, timestamp, rawBody, signature)) {
    logger.warn("webhook_signature_invalid");
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }
  if (!isTimestampFresh(timestamp, 300)) {
    return NextResponse.json({ error: "Timestamp too old" }, { status: 400 });
  }

  let envelope;
  try {
    envelope = parseEnvelope(JSON.parse(rawBody.toString("utf-8")));
  } catch (err) {
    logger.warn("webhook_envelope_invalid", { err: (err as Error).message });
    return NextResponse.json({ error: "Invalid envelope" }, { status: 400 });
  }

  // Idempotency via the events table PK. ON CONFLICT DO NOTHING + RETURNING
  // gives us a one-trip atomic claim: if the row already existed, RETURNING
  // yields no rows and we treat the request as a duplicate. Avoids needing a
  // separate KV store.
  const inserted = await db.insert(schema.events).values({
    eventId: envelope.event_id,
    eventType: envelope.event_type,
    emittedAt: new Date(envelope.emitted_at),
    schemaVersion: envelope.schema_version,
    scope: envelope.data.scope,
    payload: envelope.data.payload,
    rawEnvelope: envelope as unknown as Record<string, unknown>,
    signatureValid: true,
    status: "received",
  }).onConflictDoNothing().returning({ eventId: schema.events.eventId });

  if (inserted.length === 0) {
    return NextResponse.json({ ok: true, duplicate: true }, { status: 200 });
  }

  void platformApi.logActivity({
    type: "bridge.event_received",
    severity: "info",
    event_data: {
      event_id: envelope.event_id,
      event_type: envelope.event_type,
      scope: envelope.data.scope,
      payload: envelope.data.payload,
      schema_version: envelope.schema_version,
      emitted_at: envelope.emitted_at,
    },
    pipeline_id: (envelope.data.scope as { pipeline_id?: string } | undefined)?.pipeline_id,
  }).catch((err: unknown) => logger.warn("mirror_failed", { err: (err as Error).message }));

  await publishEventForProcessing(envelope.event_id);
  return NextResponse.json({ ok: true }, { status: 200 });
}
