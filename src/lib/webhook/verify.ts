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

export function isTimestampFresh(timestamp: string, toleranceSeconds: number): boolean {
  const t = Date.parse(timestamp);
  if (Number.isNaN(t)) return false;
  return Math.abs(Date.now() - t) <= toleranceSeconds * 1000;
}
