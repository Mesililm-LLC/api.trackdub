import { sha256Hex } from "@/activation/lib/jwt";

export { sha256Hex as hashLicenseKey };

/**
 * Generate a license key in format TDUB-XXXX-XXXX-XXXX-XXXX (uppercase
 * alphanumeric groups), using crypto.getRandomValues for cryptographic
 * randomness. Ported from the archived reference implementation.
 */
export function generateLicenseKey(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const randomBytes = new Uint8Array(16);
  crypto.getRandomValues(randomBytes);

  let key = "TDUB";
  for (let group = 0; group < 4; group++) {
    key += "-";
    for (let i = 0; i < 4; i++) {
      key += chars[(randomBytes[group * 4 + i] as number) % chars.length];
    }
  }
  return key;
}

const DEV_UNLIMITED_LICENSE_KEY = "TDUB-DEV-UNLIMITED-LOCAL";

export function isDevUnlimitedLicenseKey(key: string, devLicensesEnabled: boolean): boolean {
  return devLicensesEnabled && key === DEV_UNLIMITED_LICENSE_KEY;
}
