import type { CallSofiaEvent } from "../webhook/types";
import type { ActivityLogEntry } from "../platform-api/activity-logs";

export interface AdapterContext {
  platformApi: {
    logActivity(entry: ActivityLogEntry): Promise<void>;
    getCallDetail(callId: string): Promise<{ id: string; [k: string]: unknown }>;
  };
  config: Record<string, unknown>;
}

export interface HandlerResult {
  outcome: "success" | "noop" | "failure" | "retry";
  crm_record_id?: string;
  crm_record_url?: string;
  message?: string;
  error?: { code: string; message: string; retryable: boolean };
  api_calls?: number;
}

export interface HealthStatus {
  healthy: boolean;
  message?: string;
  timestamp: Date;
}

export interface CrmAdapter {
  readonly name: string;
  init(): Promise<void>;
  handle(event: CallSofiaEvent, ctx: AdapterContext): Promise<HandlerResult>;
  healthCheck(): Promise<HealthStatus>;
}
