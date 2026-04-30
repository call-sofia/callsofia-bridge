import { GET as healthCheckGet } from "@/app/api/cron/health-check/route";

export const dynamic = "force-dynamic";

interface HealthCheck {
  healthy: boolean;
  message?: string;
}

interface HealthResponse {
  healthy: boolean;
  checks: Record<string, HealthCheck>;
}

async function fetchHealth(): Promise<HealthResponse> {
  const req = new Request("http://internal/api/cron/health-check");
  const res = await healthCheckGet(req);
  return (await res.json()) as HealthResponse;
}

export default async function HealthPage() {
  const health = await fetchHealth();
  const entries = Object.entries(health.checks);

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>Bridge Health</h1>
      <p style={{ color: "#666" }}>
        Overall:{" "}
        <strong style={{ color: health.healthy ? "green" : "red" }}>
          {health.healthy ? "Healthy" : "Unhealthy"}
        </strong>
      </p>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>
            <th style={{ padding: "8px 4px" }}>Check</th>
            <th style={{ padding: "8px 4px" }}>Status</th>
            <th style={{ padding: "8px 4px" }}>Message</th>
          </tr>
        </thead>
        <tbody>
          {entries.map(([name, check]) => (
            <tr key={name} style={{ borderBottom: "1px solid #eee" }}>
              <td style={{ padding: "6px 4px" }}>
                <code>{name}</code>
              </td>
              <td style={{ padding: "6px 4px", color: check.healthy ? "green" : "red" }}>
                <strong>{check.healthy ? "Healthy" : "Unhealthy"}</strong>
              </td>
              <td style={{ padding: "6px 4px", color: check.healthy ? "#666" : "red", fontSize: 12 }}>
                {check.message ?? (check.healthy ? "" : "—")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {entries.length === 0 && (
        <p style={{ color: "#999" }}>No health checks reported.</p>
      )}
    </div>
  );
}
