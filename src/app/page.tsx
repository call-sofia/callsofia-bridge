export default function Home() {
  return (
    <main style={{ padding: 40, maxWidth: 720, margin: "0 auto" }}>
      <h1>CallSofia Bridge</h1>
      <p style={{ color: "#666" }}>
        Webhook middleware service running. See <a href="/admin">/admin</a> for
        operational dashboards.
      </p>
      <ul>
        <li>Webhook endpoint: <code>POST /api/webhooks/callsofia</code></li>
        <li>Health check: <code>GET /api/cron/health-check</code></li>
        <li>Admin: <code>/admin</code> (basic auth)</li>
      </ul>
    </main>
  );
}
