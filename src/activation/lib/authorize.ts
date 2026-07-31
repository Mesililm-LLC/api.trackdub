import { createMiddleware } from "hono/factory";
import { timingSafeEqual } from "@/lib/crypto";
import { ApiError } from "@/lib/errors";
import { loadActivationConfig } from "@/activation/config";
import type { ActivationEnv } from "@/activation/types";

/**
 * Admin-token guard for the activation Worker's mint route. Mirrors
 * src/middleware/authorize.ts but reads the activation Worker's own config
 * (its `ADMIN_API_TOKEN` secret is separate from the portal's) — reusing the
 * portal's `requireAdminToken` would pull in `loadConfig`, which validates and
 * caches portal-only bindings this Worker doesn't have.
 */
export const requireActivationAdminToken = createMiddleware<ActivationEnv>(async (c, next) => {
  const config = loadActivationConfig(c.env);
  const header = c.req.header("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";

  if (!token || !timingSafeEqual(token, config.secrets.ADMIN_API_TOKEN)) {
    throw ApiError.forbidden("Invalid admin token");
  }
  await next();
});
