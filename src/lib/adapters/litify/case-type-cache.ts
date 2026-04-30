import { litifyAuth } from "./auth";
import * as redis from "@/lib/redis/client";

const CACHE_TTL = 24 * 60 * 60; // 24h
const CACHE_PREFIX = "litify:case_type:";
const NULL_SENTINEL = "__null__";

export async function getLitifyCaseTypeId(name: string): Promise<string | null> {
  const cached = await redis.get(`${CACHE_PREFIX}${name}`);
  if (cached !== null) return cached === NULL_SENTINEL ? null : cached;

  const conn = await litifyAuth.getConnection();
  const escaped = name.replace(/'/g, "\\'");
  const result = await conn.query<{ Id: string }>(
    `SELECT Id FROM litify_pm__Case_Type__c WHERE Name = '${escaped}' LIMIT 1`,
  );
  const id = result.records[0]?.Id ?? null;
  await redis.setIfNotExists(`${CACHE_PREFIX}${name}`, id ?? NULL_SENTINEL, CACHE_TTL);
  return id;
}
