import { createMiddleware } from "hono/factory";
import type { AppEnv } from "@/types/env";

/**
 * Assigns a request id: honors an inbound `cf-ray` / `x-request-id` when
 * present, otherwise mints a UUID. Exposed on the response as `x-request-id`
 * and stored in context for logging and error envelopes.
 */
export const requestId = createMiddleware<AppEnv>(async (c, next) => {
  const inbound = c.req.header("x-request-id") ?? c.req.header("cf-ray");
  const id = inbound ?? crypto.randomUUID();
  c.set("requestId", id);
  c.header("x-request-id", id);
  await next();
});
