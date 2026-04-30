import { db, schema } from "@/lib/db/client";
import { desc } from "drizzle-orm";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function AdminHome() {
  const events = await db
    .select()
    .from(schema.events)
    .orderBy(desc(schema.events.receivedAt))
    .limit(100);

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>Recent Events</h1>
      <p style={{ color: "#666" }}>Last 100 events received by this bridge.</p>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>
            <th style={{ padding: "8px 4px" }}>Received</th>
            <th style={{ padding: "8px 4px" }}>Event Type</th>
            <th style={{ padding: "8px 4px" }}>Status</th>
            <th style={{ padding: "8px 4px" }}>Event ID</th>
          </tr>
        </thead>
        <tbody>
          {events.map((e) => (
            <tr key={e.eventId} style={{ borderBottom: "1px solid #eee" }}>
              <td style={{ padding: "6px 4px" }}>{new Date(e.receivedAt).toLocaleString()}</td>
              <td style={{ padding: "6px 4px" }}>
                <code>{e.eventType}</code>
              </td>
              <td style={{ padding: "6px 4px" }}>{e.status}</td>
              <td style={{ padding: "6px 4px" }}>
                <Link href={`/admin/events/${e.eventId}`}>{e.eventId.slice(0, 8)}…</Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {events.length === 0 && (
        <p style={{ color: "#999" }}>No events yet. Place a test call to see them appear here.</p>
      )}
    </div>
  );
}
