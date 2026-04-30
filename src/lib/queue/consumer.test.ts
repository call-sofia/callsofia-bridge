import { describe, it, expect } from "vitest";
import { computeBackoff } from "./consumer";

describe("computeBackoff", () => {
  it("attempt 1 → roughly base", () => {
    const ms = computeBackoff(1, { baseMs: 1000, maxMs: 60_000 });
    expect(ms).toBeGreaterThan(500);
    expect(ms).toBeLessThan(2000);
  });
  it("attempt 5 → exponential growth", () => {
    const ms = computeBackoff(5, { baseMs: 1000, maxMs: 60_000 });
    expect(ms).toBeGreaterThan(8000);
  });
  it("clamps to max with jitter window", () => {
    const ms = computeBackoff(20, { baseMs: 1000, maxMs: 60_000 });
    expect(ms).toBeLessThanOrEqual(60_000 * 1.25);
    expect(ms).toBeGreaterThanOrEqual(60_000 * 0.75);
  });
});
