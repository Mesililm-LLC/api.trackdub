import { Hono } from "hono";
import { loadConfig } from "@/config/env";
import { logger } from "@/lib/logger";
import { dubCapabilities } from "@/lib/capabilities";
import type { AppEnv } from "@/types/env";

/**
 * Health endpoints. The portal's OpenAPI contract expects three:
 *   GET /api/health        — detailed status (HealthResponse)
 *   GET /api/health/live   — liveness (Worker responding)   200 | 503
 *   GET /api/health/ready  — readiness (D1 reachable)       200 | 503
 *
 * `/api/version` (build metadata) is exposed as a sibling in routes/version.ts.
 */
export const health = new Hono<AppEnv>();

async function pingDb(db: D1Database): Promise<boolean> {
  try {
    await db.prepare("SELECT 1").first();
    return true;
  } catch (err) {
    logger.warn("d1 health probe failed", {
      message: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

/** True when the dub_jobs migration is present (not just D1 reachable). */
async function dubsSchemaReady(db: D1Database): Promise<boolean> {
  try {
    const row = await db
      .prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'dub_jobs' LIMIT 1")
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

// Readiness: safe to receive traffic — requires D1 reachable.
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
  if (capabilities.jobProcessing) availablePipelines.push("dub-processing");
  return c.json(
    {
      status: dbOk ? "healthy" : "degraded",
      timestamp: new Date().toISOString(),
      runtimeStatus: "cloudflare-workers",
      environment: config.public.APP_ENV,
      // Worker-model fields (processId/uptime/memoryMb) are not meaningful on
      // the edge runtime; see docs/CONTRACT-MISMATCHES.md. Returned as null.
      processId: null,
      uptime: null,
      memoryMb: null,
      availablePipelines,
      capabilities,
    },
    dbOk ? 200 : 503,
  );
});
