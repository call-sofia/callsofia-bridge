import { logger } from "../logger";

export interface QueueMessage {
  event_id: string;
  attempt?: number;
}

const QUEUE_ENDPOINT = process.env.VERCEL_QUEUE_PUBLISH_URL ?? "";
const QUEUE_TOKEN = process.env.QUEUE_TOKEN ?? "";

export async function publishEventForProcessing(eventId: string, attempt = 1): Promise<void> {
  const message: QueueMessage = { event_id: eventId, attempt };

  if (!QUEUE_ENDPOINT) {
    // Fallback: direct invoke consumer via fetch (dev mode / Queues unavailable)
    const url = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000";
    void fetch(`${url}/api/queue/consumer`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-queue-token": process.env.QUEUE_INTERNAL_TOKEN ?? "",
      },
      body: JSON.stringify(message),
    }).catch((err) => logger.warn("queue_fallback_failed", { err: (err as Error).message }));
    return;
  }

  const res = await fetch(QUEUE_ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${QUEUE_TOKEN}`,
    },
    body: JSON.stringify(message),
  });
  if (!res.ok) throw new Error(`Queue publish failed: ${res.status}`);
}
