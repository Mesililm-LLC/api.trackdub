import { describe, it, expect } from "vitest";
import app from "@/activation/index";
import { sha256Hex } from "@/activation/lib/jwt";
import { bindings, seedLicense, fingerprint } from "./helpers";

const DEV_UNLIMITED_LICENSE_KEY = "TDUB-DEV-UNLIMITED-LOCAL";

describe("dev-unlimited license key", () => {
  it("bypasses max_machines when ALLOW_DEV_LICENSES=true", async () => {
    // Seed the fixed dev key hash so lookupLicenseByKey resolves it, same as
    // production requires (the key must exist in D1 — this Worker never
    // special-cases the row itself, only the seat-cap check on activation).
    await seedLicense({ maxMachines: 1 });
    const keyHash = await sha256Hex(DEV_UNLIMITED_LICENSE_KEY);
    await bindings.DB.prepare(
      `INSERT INTO licenses (id, key_hash, tier, buyer_email, status, max_machines) VALUES (?, ?, 'pro', 'dev@local', 'active', 1)`,
    )
      .bind(crypto.randomUUID(), keyHash)
      .run();

    const fp1 = await fingerprint("dev-1");
    const fp2 = await fingerprint("dev-2");
    const fp3 = await fingerprint("dev-3");

    for (const fp of [fp1, fp2, fp3]) {
      const res = await app.request(
        "/activate",
        { method: "POST", body: JSON.stringify({ key: DEV_UNLIMITED_LICENSE_KEY, fingerprint: fp }) },
        bindings,
      );
      expect(res.status).toBe(200);
    }
  });
});
