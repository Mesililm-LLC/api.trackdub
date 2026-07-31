import { createMiddleware } from "hono/factory";
import type { Context } from "hono";
import { logger } from "@/lib/logger";
import { ApiError, toErrorBody } from "@/lib/errors";
import { ActivationConfigError } from "@/activation/config";
import type { ActivationEnv } from "@/activation/types";

/**
 * Cross-cutting middleware for the activation Worker, mirroring
 * src/middleware/{request-id,logging,error}.ts. Not reused directly: those
 * are typed to the portal's `AppEnv`, whose `Bindings` are a different,
 * disjoint set from `ActivationEnv` — see src/activation/types.ts for why the
 * two Workers deliberately don't share a binding surface.
 */

export const requestId = createMiddleware<ActivationEnv>(async (c, next) => {
  const inbound = c.req.header("x-request-id") ?? c.req.header("cf-ray");
  const id = inbound ?? crypto.randomUUID();
  c.set("requestId", id);
  c.header("x-request-id", id);
  await next();
});

export const requestLogging = createMiddleware<ActivationEnv>(async (c, next) => {
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

/**
 * Centralized error handler. Most activation routes (activate/reactivate/
 * deactivate/status) respond with the flat `{ error, max? }` envelope
 * directly (see lib/respond.ts) and never throw — those never reach this
 * function. The admin mint route is the exception: it reuses the portal's
 * `validate` middleware, which throws `ApiError`, so that's translated here
 * using the portal's structured envelope. That route has no shipped desktop
 * client depending on the flat shape, so the mixed envelope is confined to
 * an operator-only endpoint. Everything else that reaches here is an
 * unexpected exception or config error; never echoes exception detail to the
 * client.
 */
export function onError(err: Error, c: Context<ActivationEnv>): Response {
  const requestId = c.get("requestId") ?? "unknown";

  if (err instanceof ApiError) {
    logger.warn("handled error", { requestId, code: err.code, status: err.status, message: err.message });
    return c.json(toErrorBody(err, requestId), err.status);
  }

  if (err instanceof ActivationConfigError) {
    logger.error("activation configuration error", { requestId, message: err.message });
    return c.json({ error: "server_error" }, 500);
  }

  logger.error("unhandled activation error", {
    requestId,
    message: err.message,
    stack: err.stack,
  });
  return c.json({ error: "server_error" }, 500);
}
