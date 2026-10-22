import { Hono } from "hono";
import { loadConfig } from "@/config/env";
import type { AppEnv } from "@/types/env";

/**
 * GET /api/version — build metadata. Not currently consumed by the portal
 * contract, but required as a PR1 deliverable and useful for deploy verification.
 *
 * `build`/`commit` come from `BUILD_ID` / `GIT_SHA`, which the task definition
 * sets from the deployed image tag, falling back to "unknown".
 */
export const version = new Hono<AppEnv>();

version.get("/", (c) => {
  const config = loadConfig(c.env);
  return c.json({
    build: c.env.BUILD_ID ?? "unknown",
    commit: c.env.GIT_SHA ?? "unknown",
    environment: config.public.APP_ENV,
  });
});
