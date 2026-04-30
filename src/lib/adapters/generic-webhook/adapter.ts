import crypto from "crypto";
import { config } from "@/lib/config";
import { logger } from "@/lib/logger";
import type { CrmAdapter, AdapterContext, HandlerResult, HealthStatus } from "../types";
import type { CallSofiaEvent } from "@/lib/webhook/types";
import { transformEvent } from "./transforms";

export class GenericWebhookAdapter implements CrmAdapter {
  readonly name = "generic-webhook";
  private url!: string;
  private secret?: string;
  private transform!: "raw" | "flat" | "litify-shape";

  async init(): Promise<void> {
    const cfg = config().genericWebhook;
    if (!cfg.url) throw new Error("GENERIC_WEBHOOK_URL not set");
    this.url = cfg.url;
    this.secret = cfg.secret;
    this.transform = cfg.transform;
  }

  async handle(event: CallSofiaEvent, _ctx: AdapterContext): Promise<HandlerResult> {
    const body = JSON.stringify(transformEvent(event, this.transform));
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "x-callsofia-event": event.event_type,
      "x-callsofia-event-id": event.event_id,
    };
    if (this.secret) {
      const ts = new Date().toISOString();
      const sig = "sha256=" + crypto.createHmac("sha256", this.secret).update(`${ts}.${body}`).digest("hex");
      headers["x-callsofia-bridge-timestamp"] = ts;
      headers["x-callsofia-bridge-signature"] = sig;
    }
    try {
      const res = await fetch(this.url, { method: "POST", headers, body });
      if (res.ok) {
        logger.info("generic_webhook_success", { url: this.url, status: res.status });
        return { outcome: "success", message: `POST ${res.status}`, api_calls: 1 };
      }
      const retryable = res.status >= 500 || res.status === 429;
      return { outcome: retryable ? "retry" : "failure", error: { code: `http_${res.status}`, message: `Forwarder returned ${res.status}`, retryable }, api_calls: 1 };
    } catch (err) {
      return { outcome: "retry", error: { code: "network_error", message: (err as Error).message, retryable: true }, api_calls: 1 };
    }
  }

  async healthCheck(): Promise<HealthStatus> {
    return { healthy: !!this.url, message: this.url ? "configured" : "no URL", timestamp: new Date() };
  }
}
