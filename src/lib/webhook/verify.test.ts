import { describe, it, expect } from "vitest";
import crypto from "crypto";
import { verifySignature, isTimestampFresh } from "./verify";

// Generated per test run — not a stored credential.
const SECRET = "whsec_" + crypto.randomBytes(8).toString("hex");
const TIMESTAMP = "2026-04-29T13:00:00+00:00";
const BODY = Buffer.from('{"event_id":"a"}', "utf-8");
const SIGNED =
  "sha256=" +
  crypto
    .createHmac("sha256", SECRET)
    .update(Buffer.concat([Buffer.from(TIMESTAMP, "utf-8"), Buffer.from("."), BODY]))
    .digest("hex");

describe("verifySignature", () => {
  it("accepts valid signature", () => {
    expect(verifySignature(SECRET, TIMESTAMP, BODY, SIGNED)).toBe(true);
  });
  it("rejects tampered body", () => {
    expect(verifySignature(SECRET, TIMESTAMP, Buffer.from("{}"), SIGNED)).toBe(false);
  });
  it("rejects wrong secret", () => {
    expect(verifySignature("wrong", TIMESTAMP, BODY, SIGNED)).toBe(false);
  });
  it("rejects malformed header", () => {
    expect(verifySignature(SECRET, TIMESTAMP, BODY, "garbage")).toBe(false);
  });
  it("rejects empty signature header", () => {
    expect(verifySignature(SECRET, TIMESTAMP, BODY, "")).toBe(false);
  });
  it("rejects mismatched-length signature without throwing", () => {
    expect(verifySignature(SECRET, TIMESTAMP, BODY, "sha256=abc")).toBe(false);
  });
});

describe("isTimestampFresh", () => {
  it("rejects timestamps > 5 min old", () => {
    const old = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    expect(isTimestampFresh(old, 300)).toBe(false);
  });
  it("accepts recent timestamps", () => {
    expect(isTimestampFresh(new Date().toISOString(), 300)).toBe(true);
  });
  it("rejects unparseable timestamps", () => {
    expect(isTimestampFresh("not-a-date", 300)).toBe(false);
  });
});
