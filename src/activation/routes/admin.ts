import { Hono } from "hono";
import { z } from "zod";
import { requireActivationAdminToken } from "@/activation/lib/authorize";
import { validate } from "@/middleware/validate";
import { hashLicenseKey, generateLicenseKey } from "@/activation/lib/license-key";
import type { ActivationEnv } from "@/activation/types";

/**
 * Operator-only license minting.
 *
 * Purchase webhooks (Stripe/Lemon Squeezy) that would normally mint keys
 * automatically are deferred to a later PR — see docs/ACTIVATION-CONTRACT.md.
 * Until then, this is how a license key gets issued at all: an operator
 * holding `ADMIN_API_TOKEN` calls this after confirming payment out of band.
 *
 * Errors here throw and are caught by the shared activation `onError`
 * (src/activation/middleware.ts), same as everywhere else in this Worker —
 * this route needs no special-cased error envelope of its own.
 */
export const admin = new Hono<ActivationEnv>();

const mintSchema = z.object({
  email: z.string().email(),
  tier: z.string().min(1).max(50).optional(),
  maxMachines: z.number().int().min(1).max(50).optional(),
});

admin.post(
  "/licenses",
  requireActivationAdminToken,
  validate<typeof mintSchema, ActivationEnv>("json", mintSchema),
  async (c) => {
    const { email, tier, maxMachines } = c.get("valid_json");

    const licenseKey = generateLicenseKey();
    const keyHash = await hashLicenseKey(licenseKey);
    const licenseId = crypto.randomUUID();

    await c.env.DB.prepare(
      `INSERT INTO licenses (id, key_hash, tier, buyer_email, status, max_machines)
       VALUES (?, ?, ?, ?, 'active', ?)`,
    )
      .bind(licenseId, keyHash, tier ?? "pro", email, maxMachines ?? 2)
      .run();

    // Returned exactly once — only key_hash is ever persisted.
    return c.json({ licenseKey, licenseId }, 201);
  },
);
