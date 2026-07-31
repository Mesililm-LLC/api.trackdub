import { describe, it, expect } from "vitest";
import app from "@/activation/index";
import { bindings, seedLicense, fingerprint } from "./helpers";

describe("POST /deactivate", () => {
  it("releases an active seat", async () => {
    const { licenseKey } = await seedLicense();
    const fp = await fingerprint("deact-1");
    await app.request("/activate", { method: "POST", body: JSON.stringify({ key: licenseKey, fingerprint: fp }) }, bindings);

    const res = await app.request(
      "/deactivate",
      { method: "POST", body: JSON.stringify({ key: licenseKey, fingerprint: fp }) },
      bindings,
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "released" });

    // Seat freed: a third fingerprint should now fit within a max of 2.
    const fp2 = await fingerprint("deact-2");
    const fp3 = await fingerprint("deact-3");
    await app.request("/activate", { method: "POST", body: JSON.stringify({ key: licenseKey, fingerprint: fp2 }) }, bindings);
    const third = await app.request(
      "/activate",
      { method: "POST", body: JSON.stringify({ key: licenseKey, fingerprint: fp3 }) },
      bindings,
    );
    expect(third.status).toBe(200);
  });

  it("is idempotent when nothing was active", async () => {
    const { licenseKey } = await seedLicense();
    const fp = await fingerprint("deact-never-active");

    const res = await app.request(
      "/deactivate",
      { method: "POST", body: JSON.stringify({ key: licenseKey, fingerprint: fp }) },
      bindings,
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "released" });
  });

  it("rejects a revoked license with 403", async () => {
    const { licenseKey } = await seedLicense({ status: "revoked" });

    const res = await app.request(
      "/deactivate",
      { method: "POST", body: JSON.stringify({ key: licenseKey, fingerprint: await fingerprint("x") }) },
      bindings,
    );

    expect(res.status).toBe(403);
  });
});
