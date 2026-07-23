import { Hono } from "hono";
import { loadConfig } from "@/config/env";
import type { AppEnv } from "@/types/env";

/**
 * GET /api/version — build metadata. Not currently consumed by the portal
 * contract, but required as a PR1 deliverable and useful for deploy verification.
 *
 * `build`/`commit` come from Cloudflare's Version Metadata binding when enabled
 * (`[version_metadata]` in wrangler config), falling back to "unknown".
 */
export const version = new Hono<AppEnv>();

version.get("/", (c) => {
  const config = loadConfig(c.env);
  const meta = c.env.CF_VERSION_METADATA;
  return c.json({
    build: meta?.tag ?? "unknown",
    commit: meta?.id ?? "unknown",
    environment: config.public.APP_ENV,
  });
});
