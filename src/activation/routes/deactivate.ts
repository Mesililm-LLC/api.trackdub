import { Hono } from "hono";
import { lookupLicenseByKey } from "@/activation/lib/license-lookup";
import { activationError, isValidFingerprint, isValidKey } from "@/activation/lib/respond";
import type { ActivationEnv } from "@/activation/types";

export const deactivate = new Hono<ActivationEnv>();

/**
 * POST /deactivate — release the active seat for a license key + fingerprint
 * (local Settings "Deactivate"). Idempotent: returns 200 even when nothing
 * was active, since the desktop treats any 2xx as success and removes its
 * local token regardless.
 */
deactivate.post("/", async (c) => {
  let body: { key?: unknown; fingerprint?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return activationError(c, "invalid_key", 400);
  }

  // See activate.ts: a `null` JSON body parses without throwing, so guard
  // the destructure separately from the try/catch above.
  const { key, fingerprint } = body ?? {};

  if (!isValidKey(key)) {
    return activationError(c, "invalid_key", 400);
  }
  if (!isValidFingerprint(fingerprint)) {
    return activationError(c, "invalid_fingerprint", 400);
  }

  const license = await lookupLicenseByKey(c.env.DB, key);
  if (!license) {
    return activationError(c, "invalid_key", 400);
  }
  if (license.status === "revoked") {
    return activationError(c, "key_revoked", 403);
  }

  const activation = await c.env.DB.prepare(
    "SELECT id FROM activations WHERE license_id = ? AND fingerprint_hash = ? AND status = ?",
  )
    .bind(license.id, fingerprint, "active")
    .first<{ id: string }>();

  if (!activation) {
    return c.json({ status: "released" }, 200);
  }

  const releasedAt = new Date().toISOString();
  await c.env.DB.prepare("UPDATE activations SET status = ?, released_at = ? WHERE id = ? AND status = ?")
    .bind("released", releasedAt, activation.id, "active")
    .run();

  return c.json({ status: "released" }, 200);
});
