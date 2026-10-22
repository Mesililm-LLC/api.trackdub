import { Hono } from "hono";
import { loadConfig } from "@/config/env";
import { logger } from "@/lib/logger";
import { dubCapabilities } from "@/lib/capabilities";
import type { SqlDatabase } from "@/platform/sql";
import type { AppEnv } from "@/types/env";

/**
 * Health endpoints. The portal's OpenAPI contract expects three:
 *   GET /api/health        — detailed status (HealthResponse)
 *   GET /api/health/live   — liveness (process responding)  200 | 503
 *   GET /api/health/ready  — readiness (database reachable) 200 | 503
 *
 * `/api/version` (build metadata) is exposed as a sibling in routes/version.ts.
 */
export const health = new Hono<AppEnv>();

async function pingDb(db: SqlDatabase): Promise<boolean> {
  try {
    await db.prepare("SELECT 1").first();
    return true;
  } catch (err) {
    logger.warn("database health probe failed", {
      message: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

/** True when the dub_jobs migration is present (not just the database reachable). */
async function dubsSchemaReady(db: SqlDatabase): Promise<boolean> {
  try {
    const row = await db
      .prepare("SELECT 1 AS ok WHERE to_regclass('dub_jobs') IS NOT NULL")
      .first<{ ok: number }>();
    return row?.ok === 1;
  } catch (err) {
    logger.warn("dubs schema probe failed", {
      message: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

// Liveness: process is alive and routing works. No dependencies checked.
health.get("/live", (c) => c.json({ status: "ok" }, 200));

// Readiness: safe to receive traffic — requires the database reachable.
health.get("/ready", async (c) => {
  const dbOk = await pingDb(c.env.DB);
  return dbOk
    ? c.json({ status: "ready" }, 200)
    : c.json({ status: "unavailable", reason: "database_unreachable" }, 503);
});

// Detailed health — shaped to the portal's HealthResponse schema.
health.get("/", async (c) => {
  const config = loadConfig(c.env);
  const dbOk = await pingDb(c.env.DB);
  const dubsOk = dbOk ? await dubsSchemaReady(c.env.DB) : false;
  const capabilities = dubCapabilities(c.env, dubsOk);
  const availablePipelines: string[] = [];
  if (dbOk) availablePipelines.push("auth");
  if (dubsOk) availablePipelines.push("dub-management");
  if (dubsOk && capabilities.jobProcessing) availablePipelines.push("dub-processing");
  return c.json(
    {
      status: dbOk ? "healthy" : "degraded",
      timestamp: new Date().toISOString(),
      runtimeStatus: "container",
      environment: config.public.APP_ENV,
      // processId/uptime/memoryMb are not reported; see
      // docs/CONTRACT-MISMATCHES.md. Returned as null.
      processId: null,
      uptime: null,
      memoryMb: null,
      availablePipelines,
      capabilities,
    },
    dbOk ? 200 : 503,
  );
});
