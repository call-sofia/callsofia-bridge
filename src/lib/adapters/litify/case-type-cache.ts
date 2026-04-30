import { litifyAuth } from "./auth";

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h

interface CacheEntry { id: string | null; expiresAt: number }

// In-memory per-instance cache. Cold starts re-fetch from Salesforce.
// For higher-volume Litify deployments, swap for a Postgres-backed cache
// using the bridge's existing DATABASE_URL connection.
const cache = new Map<string, CacheEntry>();

export async function getLitifyCaseTypeId(name: string): Promise<string | null> {
  const now = Date.now();
  const cached = cache.get(name);
  if (cached && cached.expiresAt > now) return cached.id;

  const conn = await litifyAuth.getConnection();
  const escaped = name.replace(/'/g, "\\'");
  const result = await conn.query<{ Id: string }>(
    `SELECT Id FROM litify_pm__Case_Type__c WHERE Name = '${escaped}' LIMIT 1`,
  );
  const id = result.records[0]?.Id ?? null;
  cache.set(name, { id, expiresAt: now + CACHE_TTL_MS });
  return id;
}

/** Test-only: clear cache between cases. */
export function _resetCaseTypeCache(): void {
  cache.clear();
}
