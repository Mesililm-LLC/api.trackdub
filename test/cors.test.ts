import { env } from "./support/portal-env";
import { describe, it, expect } from "vitest";
import app from "@/index";
import type { Bindings } from "@/types/env";

const bindings = env as unknown as Bindings;
const PORTAL = "https://portal.trackdub.com";

describe("CORS", () => {
  it("reflects the portal origin and allows credentials", async () => {
    const res = await app.request(
      "/api/health/live",
      { headers: { Origin: PORTAL } },
      bindings,
    );
    expect(res.headers.get("access-control-allow-origin")).toBe(PORTAL);
    expect(res.headers.get("access-control-allow-credentials")).toBe("true");
  });

  it("never returns a wildcard origin", async () => {
    const res = await app.request(
      "/api/health/live",
      { headers: { Origin: PORTAL } },
      bindings,
    );
    expect(res.headers.get("access-control-allow-origin")).not.toBe("*");
  });

  it("does not authorize a disallowed origin", async () => {
    const res = await app.request(
      "/api/health/live",
      { headers: { Origin: "https://evil.example.com" } },
      bindings,
    );
    expect(res.headers.get("access-control-allow-origin")).not.toBe("https://evil.example.com");
    expect(res.headers.get("access-control-allow-origin")).not.toBe("*");
  });

  it("handles OPTIONS preflight for the portal origin", async () => {
    const res = await app.request(
      "/api/languages",
      {
        method: "OPTIONS",
        headers: {
          Origin: PORTAL,
          "Access-Control-Request-Method": "GET",
          "Access-Control-Request-Headers": "content-type",
        },
      },
      bindings,
    );
    expect([200, 204]).toContain(res.status);
    expect(res.headers.get("access-control-allow-origin")).toBe(PORTAL);
    expect(res.headers.get("access-control-allow-credentials")).toBe("true");
  });
});
