import { db, schema } from "@/lib/db/client";
import { desc, eq } from "drizzle-orm";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function FailuresPage() {
  const failed = await db.select().from(schema.deliveries)
    .where(eq(schema.deliveries.status, "failed"))
    .orderBy(desc(schema.deliveries.completedAt))
    .limit(100);

  return (
    <div>
      <h1>Failures</h1>
      <p style={{ color: "#666" }}>Last 100 failed deliveries. Click Retry to re-enqueue.</p>
      {failed.length === 0 && <p style={{ color: "#999" }}>No failures.</p>}
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>
            <th>Time</th><th>Event ID</th><th>Handler</th><th>Error</th><th></th>
          </tr>
        </thead>
        <tbody>
          {failed.map((d) => (
            <tr key={d.id} style={{ borderBottom: "1px solid #eee" }}>
              <td>{d.completedAt ? new Date(d.completedAt).toLocaleString() : "—"}</td>
              <td><Link href={`/admin/events/${d.eventId}`}>{d.eventId.slice(0, 8)}…</Link></td>
              <td>{d.handlerId}</td>
              <td style={{ color: "red", fontSize: 12 }}>{d.errorMessage}</td>
              <td>
                <form method="POST" action={`/api/admin/replay?event_id=${d.eventId}`}>
                  <button type="submit">Retry</button>
                </form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
