import { Hono } from "hono";
import { loadActivationConfig } from "@/activation/config";
import { buildClaims, signLicenseToken } from "@/activation/lib/jwt";
import { isDevUnlimitedLicenseKey } from "@/activation/lib/license-key";
import { lookupLicenseByKey } from "@/activation/lib/license-lookup";
import { activationError, isValidFingerprint, isValidKey } from "@/activation/lib/respond";
import { getActiveMachineFingerprints, releaseActivation, replaceActivationSeat, upsertActiveActivationUnlimited } from "@/activation/lib/seats";
import type { ActivationEnv } from "@/activation/types";

export const reactivate = new Hono<ActivationEnv>();

/**
 * POST /reactivate — release one existing activation and register a new
 * fingerprint (moving a license to a replacement machine). Not called by any
 * shipped desktop build today (only /activate and /deactivate are), but ported
 * faithfully to the reference contract for support workflows and future use.
 */
reactivate.post("/", async (c) => {
  let body: { key?: unknown; old_fingerprint?: unknown; new_fingerprint?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return activationError(c, "invalid_key", 400);
  }

  // See activate.ts: a `null` JSON body parses without throwing, so guard
  // the destructure separately from the try/catch above.
  const { key, old_fingerprint: oldFingerprint, new_fingerprint: newFingerprint } = body ?? {};

  if (!isValidKey(key)) {
    return activationError(c, "invalid_key", 400);
  }
  if (!isValidFingerprint(oldFingerprint)) {
    return activationError(c, "invalid_fingerprint", 400);
  }
  if (!isValidFingerprint(newFingerprint)) {
    return activationError(c, "invalid_fingerprint", 400);
  }

  const config = loadActivationConfig(c.env);
  const license = await lookupLicenseByKey(c.env.DB, key);
  if (!license) {
    return activationError(c, "invalid_key", 400);
  }
  if (license.status === "revoked") {
    return activationError(c, "key_revoked", 403);
  }

  const oldActivation = await c.env.DB.prepare(
    "SELECT id FROM activations WHERE license_id = ? AND fingerprint_hash = ? AND status = ?",
  )
    .bind(license.id, oldFingerprint, "active")
    .first<{ id: string }>();

  if (!oldActivation) {
    return activationError(c, "activation_not_found", 400);
  }

  const devUnlimited = isDevUnlimitedLicenseKey(key, config.devLicensesEnabled);

  if (oldFingerprint !== newFingerprint) {
    if (devUnlimited) {
      // Mirrors /activate's devUnlimited branch: must NOT route through
      // replaceActivationSeat, which enforces max_machines via
      // ensureActiveActivation — the dev-unlimited key is exempt from the
      // seat cap everywhere else, so /reactivate can't be the one place it
      // isn't.
      if (!(await releaseActivation(c.env.DB, oldActivation.id))) {
        return activationError(c, "activation_not_found", 409);
      }
      await upsertActiveActivationUnlimited(c.env.DB, license.id, newFingerprint, () => crypto.randomUUID());
    } else {
      // Release + claim under max_machines (same predicate as /activate).
      // Prevents an A→C race with a concurrent /activate D from leaving B+C+D active.
      const swap = await replaceActivationSeat(
        c.env.DB,
        license,
        oldActivation.id,
        newFingerprint,
        () => crypto.randomUUID(),
      );

      if (swap === "old_gone") {
        return activationError(c, "activation_not_found", 409);
      }
      if (swap === "max_reached") {
        return activationError(c, "max_activations", 403, { max: license.max_machines });
      }
    }
  }
  const machines = await getActiveMachineFingerprints(c.env.DB, license.id);
  const claims = buildClaims({
    licenseId: license.id,
    tier: license.tier,
    machines,
    keyId: config.public.SIGNING_KEY_ID,
    issuer: config.public.ACTIVATION_ISSUER,
    audience: config.public.ACTIVATION_AUDIENCE,
    devUnlimited,
  });
  const token = await signLicenseToken(claims, config.secrets.SIGNING_KEY, config.public.SIGNING_KEY_ID);

  return c.json({ token }, 200);
});
