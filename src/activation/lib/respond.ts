import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

/**
 * Activation-specific response helpers.
 *
 * The activation endpoints deliberately do NOT use the portal's error envelope
 * (`{ error: { code, message, requestId } }` from `src/lib/errors.ts`). The
 * desktop client is already shipped and parses a FLAT shape:
 *
 *     { "error": "max_activations", "max": 2 }
 *
 * See `LicensePanelViewModel` in Trackdub-gated — it reads `error` as a string
 * and `max` as a number. Reshaping this to match the portal would break every
 * installed build, and changing the desktop would only help builds released
 * after the change. The flat envelope is the contract; the divergence is
 * intentional and load-bearing.
 */

/** Error codes the desktop knows how to render. Anything else shows generically. */
export type ActivationErrorCode =
  | "invalid_key"
  | "invalid_fingerprint"
  | "key_revoked"
  | "max_activations"
  | "activation_not_found"
  | "server_error";

export function activationError(
  c: Context,
  code: ActivationErrorCode,
  status: ContentfulStatusCode,
  extra?: Record<string, unknown>,
): Response {
  return c.json({ error: code, ...(extra ?? {}) }, status);
}

/** A 64-char lowercase hex SHA-256, as produced by `HardwareFingerprintProvider`. */
const FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/;

export function isValidFingerprint(value: unknown): value is string {
  return typeof value === "string" && FINGERPRINT_PATTERN.test(value);
}

// Real keys are 24 chars (TDUB-XXXX-XXXX-XXXX-XXXX); 128 is a generous cap
// that still bounds the SHA-256 work `lookupLicenseByKey` does on every
// request BEFORE any DB lookup can reject it — an unbounded non-empty check
// would let an attacker force arbitrarily large hashing on an unauthenticated
// endpoint.
const MAX_KEY_LENGTH = 128;

export function isValidKey(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_KEY_LENGTH;
}
