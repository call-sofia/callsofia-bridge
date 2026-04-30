import crypto from "crypto";

export function verifySignature(
  secret: string,
  timestamp: string,
  rawBody: Buffer,
  signatureHeader: string,
): boolean {
  if (!signatureHeader.startsWith("sha256=")) return false;
  const signingString = Buffer.concat([
    Buffer.from(timestamp, "utf-8"),
    Buffer.from(".", "utf-8"),
    rawBody,
  ]);
  const expected = "sha256=" + crypto.createHmac("sha256", secret).update(signingString).digest("hex");
  if (expected.length !== signatureHeader.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signatureHeader));
  } catch {
    return false;
  }
}

/**
 * Accepts both UNIX seconds (e.g., "1714501234") and ISO 8601 timestamps.
 * Platform-api sends UNIX seconds (`str(int(datetime.now(UTC).timestamp()))`,
 * webhook_delivery.py:1040). The ISO branch is kept for compatibility with
 * older clients and the bridge's own test fixtures.
 */
export function isTimestampFresh(timestamp: string, toleranceSeconds: number): boolean {
  if (!timestamp) return false;
  let t: number;
  if (/^\d{10,13}$/.test(timestamp.trim())) {
    const n = Number(timestamp.trim());
    // 10 digits → seconds; 13 digits → milliseconds.
    t = timestamp.trim().length <= 10 ? n * 1000 : n;
  } else {
    t = Date.parse(timestamp);
  }
  if (!Number.isFinite(t) || t <= 0) return false;
  return Math.abs(Date.now() - t) <= toleranceSeconds * 1000;
}
