import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import { config } from "../config";

const sql = postgres(config().storage.databaseUrl, { max: 10, idle_timeout: 20 });
export const db = drizzle(sql, { schema });
export { schema };
