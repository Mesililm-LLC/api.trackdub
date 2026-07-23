import { z } from "zod";
import type { Bindings } from "@/types/env";

/**
 * Startup configuration validation.
 *
 * Cloudflare Workers have no real "startup" hook, so we validate on first
 * request and cache the result. Invalid configuration fails fast with a clear
 * error instead of surfacing as a confusing downstream failure.
 *
 * Config is grouped deliberately:
 *   - secrets:  never logged, never sent to the client
 *   - public:   safe to expose (origins, environment name)
 *   - bindings: runtime objects (D1, R2) — presence-checked, not parsed
 */

const secretsSchema = z.object({
  BETTER_AUTH_SECRET: z
    .string({ required_error: "BETTER_AUTH_SECRET is required" })
    .min(16, "BETTER_AUTH_SECRET must be at least 16 characters"),
  ADMIN_API_TOKEN: z
    .string({ required_error: "ADMIN_API_TOKEN is required" })
    .min(16, "ADMIN_API_TOKEN must be at least 16 characters"),
});

const publicSchema = z.object({
  APP_ENV: z.enum(["development", "staging", "production"]).default("production"),
  PORTAL_ORIGIN: z
    .string({ required_error: "PORTAL_ORIGIN is required" })
    .url("PORTAL_ORIGIN must be a valid URL"),
});

export interface AppConfig {
  secrets: z.infer<typeof secretsSchema>;
  public: z.infer<typeof publicSchema>;
  /** Origins allowed by CORS: the portal plus local dev. */
  allowedOrigins: string[];
}

const LOCAL_DEV_ORIGINS = ["http://localhost:8080", "http://localhost:5173", "http://localhost:3000"];

let cached: AppConfig | null = null;

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

/**
 * Validate and return the app configuration. Throws {@link ConfigError} with an
 * aggregated, secret-free message when anything is missing or malformed.
 */
export function loadConfig(env: Bindings): AppConfig {
  if (cached) return cached;

  const issues: string[] = [];

  // Bindings are runtime objects — presence check only.
  if (!env.DB) issues.push("D1 binding `DB` is not bound");
  if (!env.MEDIA) issues.push("R2 binding `MEDIA` is not bound");

  const secrets = secretsSchema.safeParse(env);
  if (!secrets.success) {
    for (const issue of secrets.error.issues) issues.push(issue.message);
  }

  const publicCfg = publicSchema.safeParse(env);
  if (!publicCfg.success) {
    for (const issue of publicCfg.error.issues) issues.push(issue.message);
  }

  if (issues.length > 0 || !secrets.success || !publicCfg.success) {
    throw new ConfigError(`Invalid Worker configuration:\n- ${issues.join("\n- ")}`);
  }

  cached = {
    secrets: secrets.data,
    public: publicCfg.data,
    allowedOrigins: [publicCfg.data.PORTAL_ORIGIN, ...LOCAL_DEV_ORIGINS],
  };
  return cached;
}

/** Test helper — clears the memoized config between cases. */
export function __resetConfigCache(): void {
  cached = null;
}
