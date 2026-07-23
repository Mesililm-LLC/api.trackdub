import { env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import app from "@/index";
import type { Bindings } from "@/types/env";

const bindings = env as unknown as Bindings;

describe("health endpoints", () => {
  it("GET /api/health/live returns 200", async () => {
    const res = await app.request("/api/health/live", {}, bindings);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("GET /api/health/ready returns 200 when D1 is reachable", async () => {
    const res = await app.request("/api/health/ready", {}, bindings);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "ready" });
  });

  it("GET /api/health returns detailed status shaped to the portal contract", async () => {
    const res = await app.request("/api/health", {}, bindings);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.status).toBe("healthy");
    expect(body.environment).toBe("development");
    expect(body).toHaveProperty("timestamp");
    expect(body.availablePipelines).toContain("auth");
  });

  it("attaches an x-request-id header", async () => {
    const res = await app.request("/api/health/live", {}, bindings);
    expect(res.headers.get("x-request-id")).toBeTruthy();
  });

  it("GET /api/version returns build metadata", async () => {
    const res = await app.request("/api/version", {}, bindings);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toHaveProperty("build");
    expect(body).toHaveProperty("commit");
    expect(body.environment).toBe("development");
  });
});
