import { createMiddleware } from "hono/factory";
import { logger } from "@/lib/logger";
import type { AppEnv } from "@/types/env";

/**
 * Structured access log. Emits one line per request with id, method, path,
 * status, and duration. Runs after the handler so status/duration are known.
 */
export const requestLogging = createMiddleware<AppEnv>(async (c, next) => {
  const start = Date.now();
  await next();
  logger.info("request", {
    requestId: c.get("requestId"),
    method: c.req.method,
    path: new URL(c.req.url).pathname,
    status: c.res.status,
    durationMs: Date.now() - start,
  });
});
