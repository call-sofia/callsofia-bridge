import Link from "next/link";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontFamily: "system-ui, -apple-system, sans-serif", padding: 20, maxWidth: 1100, margin: "0 auto" }}>
      <nav style={{ display: "flex", gap: 16, marginBottom: 24, paddingBottom: 12, borderBottom: "1px solid #ddd" }}>
        <Link href="/admin">Recent</Link>
        <Link href="/admin/failures">Failures</Link>
        <Link href="/admin/replay">Replay</Link>
        <Link href="/admin/health">Health</Link>
      </nav>
      <main>{children}</main>
    </div>
  );
}
