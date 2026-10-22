import { sha256Hex } from "@/activation/lib/jwt";
import type { LicenseRow } from "@/activation/lib/seats";
import type { SqlDatabase } from "@/platform/sql";

/** Hash a raw license key and look up its license row. Shared by every route that takes `key`. */
export async function lookupLicenseByKey(db: SqlDatabase, key: string): Promise<LicenseRow | null> {
  const keyHash = await sha256Hex(key);
  return db
    .prepare("SELECT id, tier, status, max_machines FROM licenses WHERE key_hash = ?")
    .bind(keyHash)
    .first<LicenseRow>();
}
