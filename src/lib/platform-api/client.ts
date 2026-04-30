import { config } from "../config";
import { logger } from "../logger";
import { toCreateLogEntry, type ActivityLogEntry } from "./activity-logs";

class PlatformApiClient {
  private baseUrl: string;
  private apiKey: string;

  constructor() {
    const cfg = config();
    this.baseUrl = cfg.callsofia.apiBaseUrl;
    this.apiKey = cfg.callsofia.apiKey;
  }

  private headers(): Record<string, string> {
    return { "X-API-Key": this.apiKey, "Content-Type": "application/json" };
  }

  async logActivity(entry: ActivityLogEntry): Promise<void> {
    const cfg = config();
    if (!cfg.observability.mirrorToPlatformApi) return;
    try {
      const res = await fetch(`${this.baseUrl}/v1/logs`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(toCreateLogEntry(entry)),
      });
      if (!res.ok) logger.warn("activity_log_post_failed", { status: res.status });
    } catch (err) {
      logger.warn("activity_log_network_error", { err: (err as Error).message });
    }
  }

  async logActivityBatch(entries: ActivityLogEntry[]): Promise<void> {
    await Promise.all(entries.map(e => this.logActivity(e)));
  }

  async getCallDetail(callId: string): Promise<{ id: string; [k: string]: unknown }> {
    const res = await fetch(`${this.baseUrl}/v1/calls/${callId}`, { headers: this.headers() });
    if (!res.ok) throw new Error(`getCallDetail failed: ${res.status}`);
    return res.json();
  }

  async getLead(leadId: string): Promise<{ id: string; [k: string]: unknown }> {
    const res = await fetch(`${this.baseUrl}/v1/leads/${leadId}`, { headers: this.headers() });
    if (!res.ok) throw new Error(`getLead failed: ${res.status}`);
    return res.json();
  }
}

export const platformApi = new PlatformApiClient();
