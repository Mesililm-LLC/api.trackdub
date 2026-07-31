/**
 * ES256 license-token signing.
 *
 * Ported from the archived monorepo activation service
 * (`services/activation-service/src/index.ts` in Trackdub-Monorepo-Archive),
 * which was written and reviewed but never deployed. The crypto here is
 * unchanged from that reference; the claim set is not — see `buildClaims`.
 *
 * Wire compatibility with the desktop, verified against
 * `Trackdub/src/Trackdub.Licensing/LicenseTokenValidator.cs`:
 *
 *   WebCrypto `ECDSA/P-256/SHA-256` produces a fixed-width raw `r||s`
 *   signature (64 bytes), which is exactly the format .NET's
 *   `ECDsa.VerifyData(..., DSASignatureFormat.IeeeP1363)` expects. No DER
 *   re-encoding is needed in either direction.
 */

/** Base64url encode (no padding). */
export function base64url(data: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < data.length; i++) {
    binary += String.fromCharCode(data[i] as number);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** SHA-256 of a string as 64-char lowercase hex. */
export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Import a PKCS#8 PEM private key for ES256 signing. */
async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const body = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s/g, "");
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return crypto.subtle.importKey(
    "pkcs8",
    bytes.buffer as ArrayBuffer,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
}

export interface LicenseClaimInput {
  licenseId: string;
  tier: string;
  /** Active fingerprints, already `sha256:`-prefixed. */
  machines: string[];
  keyId: string;
  issuer: string;
  audience: string;
  /** Perpetual by default. Set only for time-limited promo/beta keys. */
  exp?: number | null;
  devUnlimited?: boolean;
}

/**
 * Build the JWT payload.
 *
 * Two deliberate differences from the archived reference implementation:
 *
 * 1. `kid` is REQUIRED and lives in the PAYLOAD, not the header. A Release
 *    build resolves signing keys through `DesktopLicenseSignatureTrustStore`,
 *    whose `ResolvePublicKeyPem` returns null for a null/empty key id — so a
 *    token without `kid` fails signature verification on every production
 *    build. The reference implementation never emitted it, which would have
 *    made every token it minted unusable.
 *
 *    Note the placement: JWT convention puts `kid` in the header, but
 *    `LicenseTokenParser.Parse` decodes `parts[1]` (the payload) into its
 *    `PayloadDto` and reads `kid` from there. We emit it in both places — the
 *    payload because that is what the shipped desktop actually reads, and the
 *    header because that is what any standard JWT tooling will look at. Do not
 *    "fix" this to header-only without changing the parser first.
 *
 * 2. `iss` / `aud` are emitted from the trust-ring issuer/audience. Nothing in
 *    the desktop compares them today, so they are informational — but emitting
 *    them now means enforcement can be switched on later without reissuing
 *    every outstanding token.
 *
 * `exp` defaults to null: purchased Pro keys are perpetual. Revocation is
 * enforced at the next online activate, not by expiring offline tokens.
 */
export function buildClaims(input: LicenseClaimInput): Record<string, unknown> {
  const now = Math.floor(Date.now() / 1000);
  const claims: Record<string, unknown> = {
    sub: input.licenseId,
    tier: input.tier,
    machines: input.machines,
    iat: now,
    exp: input.exp === undefined ? null : input.exp,
    kid: input.keyId,
    iss: input.issuer,
    aud: input.audience,
  };
  if (input.devUnlimited) {
    claims.dev_unlimited = true;
  }
  return claims;
}

/** Sign claims with ES256 and return the compact JWT. */
export async function signLicenseToken(
  claims: Record<string, unknown>,
  privateKeyPem: string,
  keyId: string,
): Promise<string> {
  const header = { alg: "ES256", typ: "JWT", kid: keyId };
  const encoder = new TextEncoder();
  const encodedHeader = base64url(encoder.encode(JSON.stringify(header)));
  const encodedPayload = base64url(encoder.encode(JSON.stringify(claims)));
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  const key = await importPrivateKey(privateKeyPem);
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    encoder.encode(signingInput),
  );

  return `${signingInput}.${base64url(new Uint8Array(signature))}`;
}
