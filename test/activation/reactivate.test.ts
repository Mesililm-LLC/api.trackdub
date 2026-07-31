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
    const status = await app.request(`/status?key=${licenseKey}`, {}, bindings);
    expect((await status.json())).toMatchObject({ activations_used: 1, activations_max: 1 });
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
