/**
 * Bridge-side activity log entry shape. Translated to platform-api's
 * `CreateLogEntry` (POST /v1/logs) by `toCreateLogEntry()` before sending.
 *
 * Platform-api required fields: level (int), category, event_type, source.
 * The bridge uses semantic `severity` strings; we map them to numeric levels.
 */
export interface ActivityLogEntry {
  type: string;
  severity: "debug" | "info" | "warn" | "error";
  event_data: Record<string, unknown>;
  source?: string;
  category?: string;
  trace_id?: string;
  call_id?: string;
  lead_id?: string;
  pipeline_id?: string;
  workflow_id?: string;
  agent_id?: string;
  user_id?: string;
  summary?: string;
  error?: string;
  duration_ms?: number;
}

export const SEVERITY_TO_LEVEL: Record<ActivityLogEntry["severity"], number> = {
  debug: 100,
  info: 200,
  warn: 300,
  error: 400,
};

/**
 * Translate to platform-api `CreateLogEntry` shape (POST /v1/logs).
 *
 * `source` defaults to `"webhook"` because platform-api enforces
 * `chk_activity_logs_source` — a CHECK constraint with an explicit allowlist
 * of source strings (`webhook`, `webhook_delivery`, `voice_agent`, etc.).
 * Anything outside the list is silently dropped by the batch writer.
 * Bridge attribution lives in `metadata.source_app="callsofia-bridge"` so we
 * can still distinguish bridge-emitted rows downstream.
 */
export function toCreateLogEntry(entry: ActivityLogEntry): Record<string, unknown> {
  const metadata = { source_app: "callsofia-bridge", ...entry.event_data };
  const out: Record<string, unknown> = {
    level: SEVERITY_TO_LEVEL[entry.severity],
    category: entry.category ?? "webhook",
    event_type: entry.type,
    source: entry.source ?? "webhook",
    metadata,
  };
  if (entry.trace_id) out.trace_id = entry.trace_id;
  if (entry.call_id) out.call_id = entry.call_id;
  if (entry.lead_id) out.lead_id = entry.lead_id;
  if (entry.pipeline_id) out.pipeline_id = entry.pipeline_id;
  if (entry.workflow_id) out.workflow_id = entry.workflow_id;
  if (entry.agent_id) out.agent_id = entry.agent_id;
  if (entry.user_id) out.user_id = entry.user_id;
  if (entry.summary) out.summary = entry.summary;
  if (entry.error) out.error = entry.error;
  if (entry.duration_ms !== undefined) out.duration_ms = entry.duration_ms;
  return out;
}
