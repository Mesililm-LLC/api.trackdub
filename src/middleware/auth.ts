import { createMiddleware } from "hono/factory";
import { createAuth } from "@/auth";
import { ApiError } from "@/lib/errors";
import type { AppEnv } from "@/types/env";

/**
 * Populates `session`/`user` from the request cookie without failing. Use on
 * routes that behave differently for anonymous vs authenticated callers.
 */
export const loadSession = createMiddleware<AppEnv>(async (c, next) => {
  const auth = createAuth(c.env);
  const result = await auth.api.getSession({ headers: c.req.raw.headers });
  c.set("session", result?.session ?? null);
  c.set("user", result?.user ?? null);
  await next();
});

/**
 * Enforces an authenticated session. Runs {@link loadSession}'s lookup and
 * throws 401 when absent. The Worker is the real authorization boundary — the
 * portal's route guards are UX only.
 */
export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  const auth = createAuth(c.env);
  const result = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!result?.session || !result.user) {
    throw ApiError.unauthorized();
  }
  c.set("session", result.session);
  c.set("user", result.user);
  await next();
});
