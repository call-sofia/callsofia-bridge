import { describe, it, expect, vi, beforeEach } from "vitest";

describe("BridgeLogger", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("logs at info level by default", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const { logger } = await import("./logger");
    logger.info("hello", { a: 1 });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("structured output is JSON with level + message + meta", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const { logger } = await import("./logger");
    logger.info("test_msg", { foo: "bar" });
    const arg = spy.mock.calls[0][0] as string;
    const parsed = JSON.parse(arg);
    expect(parsed.message).toBe("test_msg");
    expect(parsed.foo).toBe("bar");
    expect(parsed.level).toBe("info");
    expect(parsed.ts).toBeDefined();
    spy.mockRestore();
  });

  it("error goes to console.error", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { logger } = await import("./logger");
    logger.error("boom", { code: "x" });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("warn goes to console.warn", async () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { logger } = await import("./logger");
    logger.warn("careful", {});
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
