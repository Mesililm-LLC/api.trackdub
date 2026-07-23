import { createMiddleware } from "hono/factory";
import { timingSafeEqual } from "@/lib/crypto";
import { loadConfig } from "@/config/env";
import { ApiError } from "@/lib/errors";
import type { AppEnv } from "@/types/env";

/**
 * Authorization guard for internal/admin endpoints (e.g. inviting users).
 * Requires a bearer token matching `ADMIN_API_TOKEN`, compared in constant
 * time. This is deliberately separate from {@link requireAuth}: session auth
 * proves "who you are", this proves "you hold the operator token".
 */
export const requireAdminToken = createMiddleware<AppEnv>(async (c, next) => {
  const config = loadConfig(c.env);
  const header = c.req.header("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";

  if (!token || !timingSafeEqual(token, config.secrets.ADMIN_API_TOKEN)) {
    throw ApiError.forbidden("Invalid admin token");
  }
  await next();
});
