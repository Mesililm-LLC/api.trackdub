/**
 * Bindings for the activation Worker.
 *
 * This is a SEPARATE Worker from the portal API (`src/index.ts`) with a
 * disjoint set of bindings, deployed from `cloudflare.config.ts` in
 * `activation` / `activation-staging` mode. The two
 * do not share a D1 database and must not share `Bindings` types — the whole
 * point of the split is that `SIGNING_KEY` is reachable only from activation
 * code, so a bug in a portal route cannot leak the license signing key.
 */
export interface ActivationBindings {
  /** D1 holding `licenses` + `activations`. Separate DB from the portal's. */
  DB: D1Database;

  // --- Public configuration (wrangler `vars`) ---
  APP_ENV: string;
  /** Issuer URI written to the `iss` claim; matches the desktop trust ring. */
  ACTIVATION_ISSUER: string;
  /** Audience written to the `aud` claim; matches the desktop trust ring. */
  ACTIVATION_AUDIENCE: string;
  /**
   * Trust-ring key id written to the `kid` claim. Must name a key that is
   * present and currently valid in the shipped `trackdub.trust.json`, or every
   * token this Worker mints will fail verification on the desktop.
   */
  SIGNING_KEY_ID: string;

  // --- Secrets (.dev.vars locally, `wrangler secret put` deployed) ---
  /** ECC P-256 private key, PKCS#8 PEM. The private half of SIGNING_KEY_ID. */
  SIGNING_KEY: string;
  /** Bearer token guarding `POST /admin/licenses`. */
  ADMIN_API_TOKEN: string;

  /**
   * Local/test only. When "true", enables the fixed dev license key.
   * Config validation rejects this when APP_ENV=production.
   */
  ALLOW_DEV_LICENSES?: string;
}

export interface ActivationVariables {
  requestId: string;
}

export type ActivationEnv = {
  Bindings: ActivationBindings;
  Variables: ActivationVariables;
};
