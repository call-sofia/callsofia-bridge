import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { config } from "@/lib/config";
import { logger } from "@/lib/logger";
import { selectAdapterName, getAdapter } from "@/lib/adapters/registry";
import { platformApi } from "@/lib/platform-api/client";
import { publishEventForProcessing } from "@/lib/queue/publisher";
import { computeBackoff } from "@/lib/queue/consumer";
import type { CallSofiaEvent } from "@/lib/webhook/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface QueueMessage {
  event_id: string;
  attempt?: number;
}

const handlerToggle: Record<string, keyof ReturnType<typeof config>["handlers"]> = {
  "call.ringing": "callRinging",
  "call.answered": "callAnswered",
  "call.in_progress": "callInProgress",
  "call.ended": "callEnded",
  "call.extracted": "callExtracted",
  "lead.qualified": "leadQualified",
  "lead.needs_review": "leadNeedsReview",
  "evaluation.complete": "evaluationComplete",
  "recording.ogg": "recordingOgg",
};

function isEnabledForEventType(cfg: ReturnType<typeof config>, eventType: string): boolean {
  const key = handlerToggle[eventType];
  if (!key) return true; // for events without an explicit toggle, run by default
  return cfg.handlers[key];
}

export async function POST(req: Request): Promise<Response> {
  const cfg = config();
  const internalToken = process.env.QUEUE_INTERNAL_TOKEN;
  if (internalToken && req.headers.get("x-queue-token") !== internalToken) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const message = (await req.json()) as QueueMessage;
  const eventId = message.event_id;
  const attempt = message.attempt ?? 1;

  const rows = await db
    .select()
    .from(schema.events)
    .where(eq(schema.events.eventId, eventId))
    .limit(1);
  const row = rows[0];
  if (!row) return NextResponse.json({ error: "event not found" }, { status: 404 });

  const adapterName = selectAdapterName(cfg.crmAdapter);
  if (adapterName === "none" || !isEnabledForEventType(cfg, row.eventType)) {
    await db.insert(schema.deliveries).values({
      eventId,
      handlerId: adapterName,
      attempt,
      status: "noop",
      outcome: { outcome: "noop", message: "handler disabled" },
      startedAt: new Date(),
      completedAt: new Date(),
    });
    return NextResponse.json({ ok: true, outcome: "noop" });
  }

  const adapter = await getAdapter(adapterName);
  const event: CallSofiaEvent = {
    event_id: row.eventId,
    event_type: row.eventType as never,
    emitted_at: row.emittedAt.toISOString(),
    schema_version: row.schemaVersion as 2,
    data: { scope: row.scope as never, payload: row.payload as never },
  };

  const startedAt = new Date();
  let result;
  try {
    result = await adapter.handle(event, { platformApi, config: {} } as never);
  } catch (err) {
    result = {
      outcome: "retry" as const,
      error: { code: "exception", message: (err as Error).message, retryable: true },
    };
  }
  const completedAt = new Date();

  await db.insert(schema.deliveries).values({
    eventId,
    handlerId: adapter.name,
    attempt,
    status:
      result.outcome === "success"
        ? "succeeded"
        : result.outcome === "noop"
          ? "noop"
          : result.outcome === "retry"
            ? "retrying"
            : "failed",
    outcome: result,
    crmRecordId: result.crm_record_id,
    errorCode: result.error?.code,
    errorMessage: result.error?.message,
    startedAt,
    completedAt,
  });

  void platformApi.logActivity({
    type: `bridge.handler_${
      result.outcome === "success"
        ? "succeeded"
        : result.outcome === "failure"
          ? "failed"
          : result.outcome === "noop"
            ? "noop"
            : "retry_scheduled"
    }`,
    severity: result.outcome === "failure" ? "error" : "info",
    event_data: {
      event_id: eventId,
      event_type: row.eventType,
      handler: adapter.name,
      attempt,
      latency_ms: completedAt.getTime() - startedAt.getTime(),
      crm_record_id: result.crm_record_id,
      error: result.error,
    },
  });

  if (result.outcome === "retry" && attempt < cfg.reliability.maxRetries) {
    const delay = computeBackoff(attempt, {
      baseMs: cfg.reliability.retryBaseDelayMs,
      maxMs: cfg.reliability.retryMaxDelayMs,
    });
    setTimeout(() => {
      void publishEventForProcessing(eventId, attempt + 1);
    }, delay);
  } else if (result.outcome === "retry") {
    logger.error("dead_letter_event", { event_id: eventId, attempt });
    void platformApi.logActivity({
      type: "bridge.dead_letter",
      severity: "error",
      event_data: { event_id: eventId, event_type: row.eventType, attempts: attempt },
    });
  }

  return NextResponse.json({ ok: true, outcome: result.outcome });
}
