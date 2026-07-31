import { describe, it, expect } from "vitest";
import app from "@/activation/index";
import { bindings, seedLicense, fingerprint } from "./helpers";

describe("POST /reactivate", () => {
  it("releases the old fingerprint and claims the new one", async () => {
    const { licenseKey } = await seedLicense({ maxMachines: 1 });
    const oldFp = await fingerprint("react-old");
    const newFp = await fingerprint("react-new");

    await app.request("/activate", { method: "POST", body: JSON.stringify({ key: licenseKey, fingerprint: oldFp }) }, bindings);

    const res = await app.request(
      "/reactivate",
      {
        method: "POST",
        body: JSON.stringify({ key: licenseKey, old_fingerprint: oldFp, new_fingerprint: newFp }),
      },
      bindings,
    );

    expect(res.status).toBe(200);
    const { token } = (await res.json()) as { token: string };
    expect(token).toBeTruthy();

    // The old fingerprint's seat is freed; the license is at cap 1, so
    // activating the OLD fingerprint again should now succeed (it's a fresh
    // seat claim) while the license overall still shows only one active seat.
    const status = await app.request(
      "/status",
      { method: "POST", body: JSON.stringify({ key: licenseKey }) },
      bindings,
    );
    expect((await status.json())).toMatchObject({ activations_used: 1, activations_max: 1 });
  });

  it("never leaves active seats above max_machines when the rollback's own cap check fails", async () => {
    // Exercises the same guarded-rollback SQL a genuine concurrent-/activate
    // race would hit, without needing true concurrency: seed at cap under
    // max=2, then lower max_machines to 1 (a plan downgrade mid-flight is a
    // real trigger for this, not just a test contrivance) before reactivating.
    // Unguarded, the rollback would restore the old fingerprint unconditionally
    // and leave 2 active against a max of 1.
    const { licenseId, licenseKey } = await seedLicense({ maxMachines: 2 });
    const oldFp = await fingerprint("cap-old");
    const otherFp = await fingerprint("cap-other");

    await app.request("/activate", { method: "POST", body: JSON.stringify({ key: licenseKey, fingerprint: oldFp }) }, bindings);
    await app.request("/activate", { method: "POST", body: JSON.stringify({ key: licenseKey, fingerprint: otherFp }) }, bindings);

    await bindings.DB.prepare("UPDATE licenses SET max_machines = 1 WHERE id = ?").bind(licenseId).run();

    const res = await app.request(
      "/reactivate",
      {
        method: "POST",
        body: JSON.stringify({
          key: licenseKey,
          old_fingerprint: oldFp,
          new_fingerprint: await fingerprint("cap-new"),
        }),
      },
      bindings,
    );

    // The claim for the new fingerprint fails (cap already met by `otherFp`),
    // and the rollback's own cap check also fails at the now-lowered max, so
    // the old fingerprint is NOT restored.
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "max_activations", max: 1 });

    const activeCount = await bindings.DB.prepare(
      "SELECT COUNT(*) as count FROM activations WHERE license_id = ? AND status = ?",
    )
      .bind(licenseId, "active")
      .first<{ count: number }>();
    expect(activeCount?.count).toBeLessThanOrEqual(1);
  });

  it("returns activation_not_found when the old fingerprint isn't active", async () => {
    const { licenseKey } = await seedLicense();

    const res = await app.request(
      "/reactivate",
      {
        method: "POST",
        body: JSON.stringify({
          key: licenseKey,
          old_fingerprint: await fingerprint("never-active"),
          new_fingerprint: await fingerprint("new"),
        }),
      },
      bindings,
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "activation_not_found" });
  });
});
