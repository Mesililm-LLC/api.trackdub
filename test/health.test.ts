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

  it("GET /api/health/ready returns 200 when the database is reachable", async () => {
    const res = await app.request("/api/health/ready", {}, bindings);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "ready" });
  });

  it("GET /api/health/ready returns 503 when the database is unreachable", async () => {
    const broken = {
      ...bindings,
      DB: {
        prepare: () => {
          throw new Error("database down");
        },
      } as unknown as Bindings["DB"],
    };
    const res = await app.request("/api/health/ready", {}, broken);
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({
      status: "unavailable",
      reason: "database_unreachable",
    });
  });

  it("GET /api/health returns degraded with empty pipelines when the database is unreachable", async () => {
    const broken = {
      ...bindings,
      DB: {
        prepare: () => {
          throw new Error("database down");
        },
      } as unknown as Bindings["DB"],
    };
    const res = await app.request("/api/health", {}, broken);
    expect(res.status).toBe(503);
    const degraded = (await res.json()) as Record<string, unknown>;
    expect(degraded.status).toBe("degraded");
    expect(degraded.availablePipelines).toEqual([]);
    expect(degraded.capabilities).toEqual({ jobIntake: false, upload: false, jobProcessing: false, outputDownload: false });
  });

  it("GET /api/health returns detailed status shaped to the portal contract", async () => {
    const res = await app.request("/api/health", {}, bindings);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.status).toBe("healthy");
    expect(body.environment).toBe("development");
    expect(body).toHaveProperty("timestamp");
    expect(body.availablePipelines).toContain("auth");
    expect(body.availablePipelines).toContain("dub-management");
    expect(body.availablePipelines).not.toContain("dub-processing");
    expect(body.capabilities).toEqual({
      jobIntake: false,
      upload: false,
      jobProcessing: false,
      outputDownload: true,
    });
  });

  it("GET /api/health omits dubs when dub_jobs table is missing", async () => {
    const broken = {
      ...bindings,
      DB: {
        prepare: (sql: string) => {
          if (sql.includes("to_regclass") && sql.includes("dub_jobs")) {
            return {
              first: async () => null,
            };
          }
          if (sql.trim() === "SELECT 1") {
            return {
              first: async () => ({ "1": 1 }),
            };
          }
          throw new Error(`unexpected sql: ${sql}`);
        },
      } as unknown as Bindings["DB"],
    };
    const res = await app.request("/api/health", {}, broken);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { availablePipelines: string[]; capabilities: Record<string, boolean> };
    expect(body.availablePipelines).toEqual(["auth"]);
    expect(body.capabilities).toEqual({ jobIntake: false, upload: false, jobProcessing: false, outputDownload: false });
  });

  it("does not advertise processing when dub_jobs is missing, even with processor enabled", async () => {
    const processorBindings = {
      ...bindings,
      DUB_PROCESSOR_ENABLED: "true",
      DB: {
        prepare: (sql: string) => {
          if (sql.includes("to_regclass") && sql.includes("dub_jobs")) {
            return { first: async () => null };
          }
          if (sql.trim() === "SELECT 1") {
            return { first: async () => ({ "1": 1 }) };
          }
          throw new Error(`unexpected sql: ${sql}`);
        },
      } as unknown as Bindings["DB"],
    };
    const res = await app.request("/api/health", {}, processorBindings);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { availablePipelines: string[]; capabilities: Record<string, boolean> };
    expect(body.availablePipelines).toEqual(["auth"]);
    expect(body.capabilities).toEqual({ jobIntake: false, upload: false, jobProcessing: false, outputDownload: false });
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
