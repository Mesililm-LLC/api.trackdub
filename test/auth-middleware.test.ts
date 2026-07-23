import { env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import app from "@/index";
import type { Bindings } from "@/types/env";

const bindings = env as unknown as Bindings;

describe("auth middleware (requireAuth)", () => {
  it("rejects an unauthenticated request to a protected route with 401", async () => {
    const res = await app.request("/api/languages", {}, bindings);
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  it("rejects a request bearing a garbage session cookie", async () => {
    const res = await app.request(
      "/api/languages",
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
