export interface ActivityLogEntry {
  type: string;
  severity: "debug" | "info" | "warn" | "error";
  event_data: Record<string, unknown>;
  source?: string;
}
