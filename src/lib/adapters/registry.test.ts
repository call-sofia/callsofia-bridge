import { describe, it, expect } from "vitest";
import { selectAdapterName } from "./registry";

describe("selectAdapterName", () => {
  it("accepts known names", () => {
    expect(selectAdapterName("litify")).toBe("litify");
    expect(selectAdapterName("generic-webhook")).toBe("generic-webhook");
    expect(selectAdapterName("none")).toBe("none");
  });
  it("throws on unknown adapter", () => {
    expect(() => selectAdapterName("oracle")).toThrow();
  });
});
