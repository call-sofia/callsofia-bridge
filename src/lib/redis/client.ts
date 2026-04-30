import { Redis } from "@upstash/redis";
import { config } from "../config";

let _client: Redis | null = null;
function client(): Redis {
  if (!_client) _client = new Redis({ url: config().storage.redisUrl, token: process.env.REDIS_TOKEN ?? "" });
  return _client;
}

export async function setIfNotExists(key: string, value: string, ttlSeconds: number): Promise<boolean> {
  const result = await client().set(key, value, { nx: true, ex: ttlSeconds });
  return result === "OK";
}

export async function get(key: string): Promise<string | null> {
  return (await client().get<string>(key)) ?? null;
}

export async function del(key: string): Promise<void> {
  await client().del(key);
}

export async function ping(): Promise<string> {
  return await client().ping();
}

export const idempotency = {
  /** Mark event as processed; returns true if first time (caller should process), false if duplicate. */
  async claim(eventId: string, ttlSeconds = 86400): Promise<boolean> {
    return setIfNotExists(`evt:${eventId}`, "1", ttlSeconds);
  },
};
