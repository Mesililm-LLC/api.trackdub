import { env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import app from "@/index";
import { requestId } from "@/middleware/request-id";
import { requireAuth } from "@/middleware/auth";
import { onError } from "@/middleware/error";
import { ApiError, toErrorBody } from "@/lib/errors";
import type { AppEnv, Bindings } from "@/types/env";

const bindings = env as unknown as Bindings;

/**
 * Synthetic app still covers requireAuth in isolation. Production routes under
 * `/api/dubs*` also mount it; these cases keep the middleware contract clear
 * without depending on D1/R2 job fixtures.
 */
function protectedTestApp() {
  const test = new Hono<AppEnv>();
  test.use("*", requestId);
  test.get("/protected", requireAuth, (c) => c.json({ ok: true }));
  test.notFound((c) => c.json(toErrorBody(ApiError.notFound(), c.get("requestId") ?? "unknown"), 404));
  test.onError(onError);
  return test;
}

describe("auth middleware (requireAuth)", () => {
  it("rejects an unauthenticated request to a protected route with 401", async () => {
    const res = await protectedTestApp().request("/protected", {}, bindings);
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  it("rejects a request bearing a garbage session cookie", async () => {
    const res = await protectedTestApp().request(
      "/protected",
      { headers: { Cookie: "better-auth.session_token=not-a-real-token" } },
      bindings,
    );
    expect(res.status).toBe(401);
  });
});

describe("authorization middleware (requireAdminToken)", () => {
  it("rejects the invite endpoint without the admin token", async () => {
    const res = await app.request(
      "/api/admin/invite",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "x@example.com", name: "X" }),
      },
      bindings,
    );
    expect(res.status).toBe(403);
  });

  it("rejects the invite endpoint with a wrong admin token", async () => {
    const res = await app.request(
      "/api/admin/invite",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer wrong-token",
        },
        body: JSON.stringify({ email: "x@example.com", name: "X" }),
      },
      bindings,
    );
    expect(res.status).toBe(403);
  });
});

describe("public routes stay reachable", () => {
  it("GET /api/languages returns 200 without a session", async () => {
    const res = await app.request("/api/languages", {}, bindings);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: unknown[] };
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.items.length).toBeGreaterThan(0);
  });

  it("Better Auth routes are not blocked by session middleware", async () => {
    // No requireAuth sits in front of /api/auth/*; an unauthenticated sign-in
    // attempt should reach Better Auth's own handler (invalid creds → 401/400
    // from Better Auth, never our requireAuth's generic UNAUTHORIZED).
    const res = await app.request(
      "/api/auth/sign-in/email",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "https://portal.trackdub.com" },
        body: JSON.stringify({ email: "nobody@example.com", password: "wrong" }),
      },
      bindings,
    );
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    const body = (await res.json()) as { error?: { code?: string } };
    // Better Auth's own error shape, not our ApiError envelope.
    expect(body.error?.code).not.toBe("UNAUTHORIZED");
  });
});
