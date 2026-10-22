import { z } from "zod";
import type { ActivationBindings } from "@/activation/types";

/**
 * Startup configuration validation for the activation Worker.
 *
 * Mirrors the pattern in `src/config/env.ts` but is deliberately a separate
 * module with a separate cache: the two Workers have disjoint bindings, and
 * sharing the config loader would mean each Worker validating (and holding a
 * reference to) the other's secrets.
 */

const secretsSchema = z.object({
  SIGNING_KEY: z
    .string({ required_error: "SIGNING_KEY is required" })
    .includes("BEGIN PRIVATE KEY", {
      message: "SIGNING_KEY must be a PKCS#8 PEM private key",
    }),
  ADMIN_API_TOKEN: z
    .string({ required_error: "ADMIN_API_TOKEN is required" })
    .min(16, "ADMIN_API_TOKEN must be at least 16 characters"),
});

const publicSchema = z.object({
  APP_ENV: z.enum(["development", "staging", "production"]).default("production"),
  ACTIVATION_ISSUER: z
    .string({ required_error: "ACTIVATION_ISSUER is required" })
    .url("ACTIVATION_ISSUER must be a valid URL"),
  ACTIVATION_AUDIENCE: z
    .string({ required_error: "ACTIVATION_AUDIENCE is required" })
    .min(1, "ACTIVATION_AUDIENCE must not be empty"),
  SIGNING_KEY_ID: z
    .string({ required_error: "SIGNING_KEY_ID is required" })
    .min(1, "SIGNING_KEY_ID must not be empty"),
});

export interface ActivationConfig {
  secrets: z.infer<typeof secretsSchema>;
  public: z.infer<typeof publicSchema>;
  /** True only when dev license keys are explicitly enabled outside production. */
  devLicensesEnabled: boolean;
}

let cached: ActivationConfig | null = null;

export class ActivationConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ActivationConfigError";
  }
}

export function loadActivationConfig(env: ActivationBindings): ActivationConfig {
  if (cached) return cached;

  const issues: string[] = [];

  if (!env.DB) issues.push("database binding `DB` is not bound");

  const secrets = secretsSchema.safeParse(env);
  if (!secrets.success) {
    for (const issue of secrets.error.issues) issues.push(issue.message);
  }

  const publicCfg = publicSchema.safeParse(env);
  if (!publicCfg.success) {
    for (const issue of publicCfg.error.issues) issues.push(issue.message);
  }

  // Fail closed: the dev key bypasses machine caps entirely, so a production
  // deploy that inherits ALLOW_DEV_LICENSES from a local .dev.vars would hand
  // out uncapped licenses. Refuse to boot rather than serve that.
  const devRequested = env.ALLOW_DEV_LICENSES === "true";
  if (devRequested && publicCfg.success && publicCfg.data.APP_ENV === "production") {
    issues.push("ALLOW_DEV_LICENSES must not be set when APP_ENV=production");
  }

  if (issues.length > 0 || !secrets.success || !publicCfg.success) {
    throw new ActivationConfigError(
      `Invalid activation Worker configuration:\n- ${issues.join("\n- ")}`,
    );
  }

  cached = {
    secrets: secrets.data,
    public: publicCfg.data,
    devLicensesEnabled: devRequested && publicCfg.data.APP_ENV !== "production",
  };
  return cached;
}

/** Test helper — clears the memoized config between cases. */
export function __resetActivationConfigCache(): void {
  cached = null;
}
