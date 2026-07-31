import { describe, it, expect } from "vitest";
import app from "@/activation/index";
import { bindings } from "./helpers";

describe("POST /admin/licenses", () => {
  it("rejects a request without an admin token", async () => {
    const res = await app.request(
      "/admin/licenses",
      { method: "POST", body: JSON.stringify({ email: "buyer@example.com" }) },
      bindings,
    );
    expect(res.status).toBe(403);
  });

  it("mints a license and returns the plaintext key exactly once", async () => {
    const res = await app.request(
      "/admin/licenses",
      {
        method: "POST",
        headers: { authorization: `Bearer ${bindings.ADMIN_API_TOKEN}` },
        body: JSON.stringify({ email: "buyer@example.com", maxMachines: 3 }),
      },
      bindings,
    );

    expect(res.status).toBe(201);
    const body = (await res.json()) as { licenseKey: string; licenseId: string };
    expect(body.licenseKey).toMatch(/^TDUB-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    expect(body.licenseId).toBeTruthy();

    // The minted key activates against the configured seat cap.
    const activateRes = await app.request(
      "/activate",
      { method: "POST", body: JSON.stringify({ key: body.licenseKey, fingerprint: "a".repeat(64) }) },
      bindings,
    );
    expect(activateRes.status).toBe(200);
  });

  it("rejects an invalid body with 400", async () => {
    const res = await app.request(
      "/admin/licenses",
      {
        method: "POST",
        headers: { authorization: `Bearer ${bindings.ADMIN_API_TOKEN}` },
        body: JSON.stringify({ email: "not-an-email" }),
      },
      bindings,
    );
    expect(res.status).toBe(400);
  });
});
