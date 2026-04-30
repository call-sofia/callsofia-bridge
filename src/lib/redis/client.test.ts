import { describe, it, expect, vi } from "vitest";

vi.mock("@upstash/redis", () => ({
  Redis: class {
    private store = new Map<string, string>();
    async set(k: string, v: string, opts?: { ex?: number; nx?: boolean }) {
      if (opts?.nx && this.store.has(k)) return null;
      this.store.set(k, v);
      return "OK";
    }
    async get<T = string>(k: string): Promise<T | null> { return (this.store.get(k) as T) ?? null; }
    async del(k: string) { return this.store.delete(k) ? 1 : 0; }
    async ping() { return "PONG"; }
  },
}));
vi.mock("../config", () => ({
  config: () => ({ storage: { redisUrl: "https://test.upstash.io" } }),
}));

describe("redis client", () => {
  it("setIfNotExists returns true on first call, false on duplicate", async () => {
    const { setIfNotExists } = await import("./client");
    expect(await setIfNotExists("k1", "v", 60)).toBe(true);
    expect(await setIfNotExists("k1", "v", 60)).toBe(false);
  });

  it("ping returns PONG", async () => {
    const { ping } = await import("./client");
    expect(await ping()).toBe("PONG");
  });

  it("idempotency.claim returns true once per event_id", async () => {
    const { idempotency } = await import("./client");
    expect(await idempotency.claim("evt-123")).toBe(true);
    expect(await idempotency.claim("evt-123")).toBe(false);
  });
});
