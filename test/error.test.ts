import { env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import app from "@/index";
import { onError } from "@/middleware/error";
import { requestId } from "@/middleware/request-id";
import { ApiError } from "@/lib/errors";
import type { AppEnv, Bindings } from "@/types/env";

const bindings = env as unknown as Bindings;

describe("error handling", () => {
  it("returns a consistent JSON envelope with requestId for 404", async () => {
    const res = await app.request("/api/does-not-exist", {}, bindings);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string; requestId: string } };
    expect(body.error.code).toBe("NOT_FOUND");
    expect(body.error.requestId).toBeTruthy();
  });

  it("maps ApiError to its status and code", async () => {
    const test = new Hono<AppEnv>();
    test.use("*", requestId);
    test.get("/boom", () => {
      throw ApiError.badRequest("nope", { field: "x" });
    });
    test.onError(onError);

    const res = await test.request("/boom", {}, bindings);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string; details?: unknown } };
    expect(body.error.code).toBe("BAD_REQUEST");
    expect(body.error.details).toEqual({ field: "x" });
  });

  it("never leaks stack traces for unexpected errors", async () => {
    const test = new Hono<AppEnv>();
    test.use("*", requestId);
    test.get("/crash", () => {
      throw new Error("secret internal detail");
    });
    test.onError(onError);

    const res = await test.request("/crash", {}, bindings);
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).not.toContain("secret internal detail");
    expect(text).not.toContain("stack");
    const body = JSON.parse(text) as { error: { code: string } };
    expect(body.error.code).toBe("INTERNAL");
  });
});
