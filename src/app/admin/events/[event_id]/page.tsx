import { db, schema } from "@/lib/db/client";
import { eq, asc } from "drizzle-orm";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function EventDetail({ params }: { params: Promise<{ event_id: string }> }) {
  const { event_id } = await params;

  const [event] = await db
    .select()
    .from(schema.events)
    .where(eq(schema.events.eventId, event_id))
    .limit(1);

  if (!event) return notFound();

  const deliveries = await db
    .select()
    .from(schema.deliveries)
    .where(eq(schema.deliveries.eventId, event_id))
    .orderBy(asc(schema.deliveries.attempt));

  return (
    <div>
      <h1>Event {event_id.slice(0, 8)}…</h1>
      <p style={{ color: "#666" }}>
        <code>{event.eventType}</code> received {new Date(event.receivedAt).toLocaleString()}
      </p>

      <h2>Envelope</h2>
      <pre
        style={{
          background: "#f5f5f5",
          padding: 12,
          overflow: "auto",
          fontSize: 13,
          borderRadius: 4,
          maxHeight: 400,
        }}
      >
        {JSON.stringify(event.rawEnvelope, null, 2)}
      </pre>

      <h2>Deliveries ({deliveries.length})</h2>
      {deliveries.length === 0 && (
        <p style={{ color: "#999" }}>No delivery attempts yet.</p>
      )}
      {deliveries.map((d) => (
        <div key={d.id} style={{ border: "1px solid #ddd", padding: 12, marginBottom: 8, borderRadius: 4 }}>
          <strong>Attempt {d.attempt}</strong> — handler <code>{d.handlerId}</code> — status{" "}
          <code style={{ color: d.status === "succeeded" ? "green" : d.status === "failed" ? "red" : "#666" }}>
            {d.status}
          </code>
          <div style={{ marginTop: 4 }}>CRM record: {d.crmRecordId ?? "—"}</div>
          {d.errorMessage && (
            <div style={{ color: "red", marginTop: 4 }}>
              Error ({d.errorCode}): {d.errorMessage}
            </div>
          )}
          {d.outcome != null && (
            <details style={{ marginTop: 6 }}>
              <summary style={{ cursor: "pointer" }}>Full outcome</summary>
              <pre style={{ background: "#f5f5f5", padding: 8, fontSize: 12, overflow: "auto" }}>
                {JSON.stringify(d.outcome, null, 2)}
              </pre>
            </details>
          )}
        </div>
      ))}
    </div>
  );
}
