import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import { config } from "../config";

// Lazy initialization: postgres() and drizzle() are NOT called until first use.
// Module-level construction would crash cold starts where env vars are injected
// after import (or fail builds where config() can't validate placeholder env).
let _db: PostgresJsDatabase<typeof schema> | null = null;

function getDb(): PostgresJsDatabase<typeof schema> {
  if (_db) return _db;
  // Each Function instance opens its own pool, and Vercel cold starts can
  // produce many concurrent instances. With Neon's serverless pooler (or any
  // PgBouncer-style proxy) we want a small per-instance pool — 3 connections
  // is the recommended cap to keep total connection count reasonable across
  // cold starts. Was `max: 10`, which exhausted Neon's connection budget.
  const sql = postgres(config().storage.databaseUrl, { max: 3, idle_timeout: 20 });
  _db = drizzle(sql, { schema });
  return _db;
}

export const db = new Proxy({} as PostgresJsDatabase<typeof schema>, {
  get(_target, prop, receiver) {
    return Reflect.get(getDb(), prop, receiver);
  },
}) as PostgresJsDatabase<typeof schema>;

export { schema };
