import type { Context } from "hono";
import { ApiError, toErrorBody } from "@/lib/errors";
import { ConfigError } from "@/config/env";
import { logger } from "@/lib/logger";
import type { AppEnv } from "@/types/env";

/**
 * Centralized error handler registered via `app.onError`. Maps known errors to
 * their status + code and everything else to a generic 500. Stack traces are
 * logged server-side but never returned to the client.
 */
export function onError(err: Error, c: Context<AppEnv>): Response {
  const requestId = c.get("requestId") ?? "unknown";

  if (err instanceof ApiError) {
    // Client errors (4xx) are expected; log at warn without a stack.
    logger.warn("handled error", {
      requestId,
      code: err.code,
      status: err.status,
      message: err.message,
    });
    return c.json(toErrorBody(err, requestId), err.status);
  }

  if (err instanceof ConfigError) {
    // Misconfiguration is fatal and operator-facing — log full detail, return
    // a generic 500 so config specifics never leak to clients.
    logger.error("configuration error", { requestId, message: err.message });
    return c.json(toErrorBody(ApiError.internal(), requestId), 500);
  }

  logger.error("unhandled error", {
    requestId,
    message: err.message,
    stack: err.stack,
  });
  return c.json(toErrorBody(ApiError.internal(), requestId), 500);
}
