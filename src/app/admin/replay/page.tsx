export default function ReplayPage() {
  return (
    <div>
      <h1>Bulk Replay</h1>
      <p style={{ color: "#666" }}>Re-enqueue events matching the filters below. Idempotency keys ensure no duplicates in CRM.</p>
      <form method="POST" action="/api/admin/replay" style={{ display: "grid", gap: 12, maxWidth: 480 }}>
        <label>
          Event Type: <input name="event_type" placeholder="e.g. lead.qualified" style={{ width: "100%" }} />
        </label>
        <label>
          From: <input type="datetime-local" name="from" />
        </label>
        <label>
          To: <input type="datetime-local" name="to" />
        </label>
        <button type="submit" style={{ padding: "8px 16px", marginTop: 8 }}>Replay</button>
      </form>
    </div>
  );
}
