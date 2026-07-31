import { env } from "cloudflare:test";
import { sha256Hex } from "@/activation/lib/jwt";
import type { ActivationBindings } from "@/activation/types";

export const bindings = env as unknown as ActivationBindings;

/** Insert a license row directly (bypassing the admin route) and return its plaintext key. */
export async function seedLicense(
  overrides: Partial<{ tier: string; maxMachines: number; status: string; buyerEmail: string }> = {},
): Promise<{ licenseId: string; licenseKey: string }> {
  const licenseKey = `TDUB-TEST-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const keyHash = await sha256Hex(licenseKey);
  const licenseId = crypto.randomUUID();

  await bindings.DB.prepare(
    `INSERT INTO licenses (id, key_hash, tier, buyer_email, status, max_machines)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      licenseId,
      keyHash,
      overrides.tier ?? "pro",
      overrides.buyerEmail ?? "buyer@example.com",
      overrides.status ?? "active",
      overrides.maxMachines ?? 2,
    )
    .run();

  return { licenseId, licenseKey };
}

/** A syntactically valid fingerprint (64-char lowercase hex), distinct per call. */
export async function fingerprint(seed: string): Promise<string> {
  return sha256Hex(seed);
}
