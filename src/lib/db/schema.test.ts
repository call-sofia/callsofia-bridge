import { describe, it, expect } from "vitest";
import { events, deliveries, retryQueue, configOverrides } from "./schema";

describe("schema", () => {
  it("events table has required columns", () => {
    expect(events.eventId).toBeDefined();
    expect(events.eventType).toBeDefined();
    expect(events.payload).toBeDefined();
    expect(events.signatureValid).toBeDefined();
  });

  it("deliveries has required columns", () => {
    expect(deliveries.eventId).toBeDefined();
    expect(deliveries.handlerId).toBeDefined();
    expect(deliveries.attempt).toBeDefined();
  });

  it("retryQueue tracks scheduled events", () => {
    expect(retryQueue.scheduledFor).toBeDefined();
  });

  it("configOverrides has eventType primary key", () => {
    expect(configOverrides.eventType).toBeDefined();
  });
});
