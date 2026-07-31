import { Hono } from "hono";
import { loadActivationConfig } from "@/activation/config";
import { buildClaims, signLicenseToken } from "@/activation/lib/jwt";
import { isDevUnlimitedLicenseKey } from "@/activation/lib/license-key";
import { lookupLicenseByKey } from "@/activation/lib/license-lookup";
import { activationError, isValidFingerprint, isValidKey } from "@/activation/lib/respond";
import {
  ensureActiveActivation,
  getActiveMachineFingerprints,
  upsertActiveActivationUnlimited,
} from "@/activation/lib/seats";
import type { ActivationEnv } from "@/activation/types";

export const activate = new Hono<ActivationEnv>();

/**
 * POST /activate — register a machine fingerprint against a license key and
 * return a signed JWT. Ported from the archived reference implementation;
 * see docs/ACTIVATION-CONTRACT.md for the exact wire shape the desktop
 * (`LicensePanelViewModel`) expects.
 */
activate.post("/", async (c) => {
  let body: { key?: unknown; fingerprint?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return activationError(c, "invalid_key", 400);
  }

  const { key, fingerprint } = body;

  if (!isValidKey(key)) {
    return activationError(c, "invalid_key", 400);
  }
  if (!isValidFingerprint(fingerprint)) {
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

  const devUnlimited = isDevUnlimitedLicenseKey(key, config.devLicensesEnabled);

  if (devUnlimited) {
    await upsertActiveActivationUnlimited(c.env.DB, license.id, fingerprint, () => crypto.randomUUID());
  } else {
    const result = await ensureActiveActivation(c.env.DB, license, fingerprint, () => crypto.randomUUID());
    if (result === "max_reached") {
      return activationError(c, "max_activations", 409, { max: license.max_machines });
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
