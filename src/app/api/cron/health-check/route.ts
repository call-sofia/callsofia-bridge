import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { config } from "@/lib/config";
import { db } from "@/lib/db/client";
import { getAdapter, selectAdapterName } from "@/lib/adapters/registry";
import { platformApi } from "@/lib/platform-api/client";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface CheckResult {
  healthy: boolean;
  message?: string;
}

export async function GET(_req: Request): Promise<Response> {
  const cfg = config();
  const checks: Record<string, CheckResult> = {};

  try {
    await db.execute(sql`SELECT 1`);
    checks.postgres = { healthy: true };
  } catch (err) {
    checks.postgres = { healthy: false, message: (err as Error).message };
  }

  try {
    const adapter = await getAdapter(selectAdapterName(cfg.crmAdapter));
    const r = await adapter.healthCheck();
    checks.adapter = { healthy: r.healthy, message: r.message };
  } catch (err) {
    checks.adapter = { healthy: false, message: (err as Error).message };
  }

  const allHealthy = Object.values(checks).every((c) => c.healthy);

  // Fire-and-forget mirror to platform-api activity logs
  void platformApi.logActivity({
    type: "bridge.health_check",
    severity: allHealthy ? "info" : "error",
    event_data: { checks, all_healthy: allHealthy },
  });
  logger.info("cron_health_check", { all_healthy: allHealthy, checks });

  return NextResponse.json({ healthy: allHealthy, checks });
}
