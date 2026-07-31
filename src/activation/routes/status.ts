import { Hono } from "hono";
import { loadActivationConfig } from "@/activation/config";
import { isDevUnlimitedLicenseKey } from "@/activation/lib/license-key";
import { lookupLicenseByKey } from "@/activation/lib/license-lookup";
import { activationError, isValidKey } from "@/activation/lib/respond";
import type { ActivationEnv } from "@/activation/types";

export const status = new Hono<ActivationEnv>();

/**
 * GET /status?key=<license_key> — license status: tier, activations
 * used/max, expiry. Not called by any shipped desktop build today, but
 * ported for support workflows.
 */
status.get("/", async (c) => {
  const key = c.req.query("key");

  if (!isValidKey(key)) {
    return activationError(c, "invalid_key", 400);
  }

  const config = loadActivationConfig(c.env);
  const license = await lookupLicenseByKey(c.env.DB, key);
  if (!license) {
    return activationError(c, "invalid_key", 400);
  }
  if (license.status === "revoked") {
    return activationError(c, "key_revoked", 403);
  }

  const countResult = await c.env.DB.prepare(
    "SELECT COUNT(*) as count FROM activations WHERE license_id = ? AND status = ?",
  )
    .bind(license.id, "active")
    .first<{ count: number }>();

  const activationsUsed = countResult?.count ?? 0;
  const devUnlimited = isDevUnlimitedLicenseKey(key, config.devLicensesEnabled);

  return c.json(
    {
      tier: license.tier,
      status: license.status,
      activations_used: activationsUsed,
      activations_max: devUnlimited ? null : license.max_machines,
      expires_at: null,
      ...(devUnlimited ? { dev_unlimited: true } : {}),
    },
    200,
  );
});
