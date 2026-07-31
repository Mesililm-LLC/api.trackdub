import { Hono } from "hono";
import { z } from "zod";
import { requireActivationAdminToken } from "@/activation/lib/authorize";
import { validateFor } from "@/middleware/validate";
import { hashLicenseKey, generateLicenseKey } from "@/activation/lib/license-key";
import type { ActivationEnv } from "@/activation/types";

const validate = validateFor<ActivationEnv>();

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

// generateLicenseKey draws 128 bits from crypto.getRandomValues, so a
// key_hash collision is astronomically unlikely — but "unlikely" still isn't
// "impossible" on a unique-constrained column, and regenerating is free, so a
// small bounded retry turns that theoretical case into a normal success
// instead of an operator-facing 500.
const MAX_MINT_ATTEMPTS = 5;

function isUniqueKeyHashConflict(err: unknown): boolean {
  return err instanceof Error && /UNIQUE constraint failed.*key_hash/i.test(err.message);
}

admin.post(
  "/licenses",
  requireActivationAdminToken,
  validate("json", mintSchema),
  async (c) => {
    const { email, tier, maxMachines } = c.get("valid_json");
    const licenseId = crypto.randomUUID();

    let licenseKey = "";
    for (let attempt = 1; attempt <= MAX_MINT_ATTEMPTS; attempt++) {
      licenseKey = generateLicenseKey();
      const keyHash = await hashLicenseKey(licenseKey);

      try {
        await c.env.DB.prepare(
          `INSERT INTO licenses (id, key_hash, tier, buyer_email, status, max_machines)
           VALUES (?, ?, ?, ?, 'active', ?)`,
        )
          .bind(licenseId, keyHash, tier ?? "pro", email, maxMachines ?? 2)
          .run();
        break;
      } catch (err) {
        if (isUniqueKeyHashConflict(err) && attempt < MAX_MINT_ATTEMPTS) {
          continue;
        }
        throw err;
      }
    }

    // Returned exactly once — only key_hash is ever persisted.
    return c.json({ licenseKey, licenseId }, 201);
  },
);
