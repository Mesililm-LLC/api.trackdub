import { describe, it, expect } from "vitest";
import app from "@/activation/index";
import { sha256Hex } from "@/activation/lib/jwt";
import { bindings, seedLicense, fingerprint } from "./helpers";

const DEV_UNLIMITED_LICENSE_KEY = "TDUB-DEV-UNLIMITED-LOCAL";

describe("dev-unlimited license key", () => {
  it("bypasses max_machines when ALLOW_DEV_LICENSES=true", async () => {
    // Seed the fixed dev key hash so lookupLicenseByKey resolves it, same as
    // production requires (the key must exist in the database — this service never
    // special-cases the row itself, only the seat-cap check on activation).
    await seedLicense({ maxMachines: 1 });
    const keyHash = await sha256Hex(DEV_UNLIMITED_LICENSE_KEY);
    await bindings.DB.prepare(
      `INSERT INTO licenses (id, key_hash, tier, buyer_email, status, max_machines) VALUES (?, ?, 'pro', 'dev@local', 'active', 1) ON CONFLICT (key_hash) DO NOTHING`,
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

  it("/reactivate also bypasses max_machines for the dev-unlimited key", async () => {
    // /reactivate must not route the dev key through the capped
    // replaceActivationSeat path — it's exempt from the seat cap everywhere
    // else. maxMachines: 1 here makes the bypass observable: two machines are
    // already active before the swap (over the nominal cap), and the swap
    // must still succeed.
    const keyHash = await sha256Hex(DEV_UNLIMITED_LICENSE_KEY);
    await bindings.DB.prepare(
      `INSERT INTO licenses (id, key_hash, tier, buyer_email, status, max_machines) VALUES (?, ?, 'pro', 'dev@local', 'active', 1) ON CONFLICT (key_hash) DO NOTHING`,
    )
      .bind(crypto.randomUUID(), keyHash)
      .run();

    const fpA = await fingerprint("dev-react-a");
    const fpB = await fingerprint("dev-react-b");
    const fpC = await fingerprint("dev-react-c");

    await app.request("/activate", { method: "POST", body: JSON.stringify({ key: DEV_UNLIMITED_LICENSE_KEY, fingerprint: fpA }) }, bindings);
    await app.request("/activate", { method: "POST", body: JSON.stringify({ key: DEV_UNLIMITED_LICENSE_KEY, fingerprint: fpB }) }, bindings);

    const res = await app.request(
      "/reactivate",
      {
        method: "POST",
        body: JSON.stringify({ key: DEV_UNLIMITED_LICENSE_KEY, old_fingerprint: fpA, new_fingerprint: fpC }),
      },
      bindings,
    );

    expect(res.status).toBe(200);
    const { token } = (await res.json()) as { token: string };
    expect(token).toBeTruthy();
  });
});
