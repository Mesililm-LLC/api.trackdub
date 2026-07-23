import { env } from "cloudflare:test";
import { describe, it, expect, beforeAll } from "vitest";
import app from "@/index";
import { createAuth } from "@/auth";
import { provisionUser } from "@/auth/provision";
import type { Bindings } from "@/types/env";

const bindings = env as unknown as Bindings;

const USER = {
  email: "session-user@example.com",
  name: "Session User",
  password: "correct-horse-battery-staple",
};

// The portal is a cross-origin SPA; credentialed fetches always send an Origin
// header. Better Auth enforces this on state-changing POSTs (CSRF protection),
// so tests must mirror it. This origin is in trustedOrigins.
const PORTAL = "https://portal.trackdub.com";
const jsonHeaders = { "Content-Type": "application/json", Origin: PORTAL };

beforeAll(async () => {
  // Migrations are applied by the global setup hook (test/apply-migrations.ts).
  // Provision the user directly with a known password. provisionUser hashes
  // whatever password it's given and links the credential account, so the
  // account is immediately sign-in-able — no reset round-trip needed in tests.
  const auth = createAuth(bindings);
  await provisionUser(auth, {
    email: USER.email,
    name: USER.name,
    tempPassword: USER.password,
  });
});

/** Extract the Set-Cookie session token so we can replay it as a Cookie. */
function sessionCookieFrom(res: Response): string | null {
  const setCookie = res.headers.get("set-cookie");
  if (!setCookie) return null;
  const match = /(better-auth\.session_token=[^;]+)/.exec(setCookie);
  return match ? match[1]! : null;
}

describe("session lifecycle", () => {
  it("signs in with valid credentials and issues a host-only cookie", async () => {
    const res = await app.request(
      "/api/auth/sign-in/email",
      {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ email: USER.email, password: USER.password }),
      },
      bindings,
    );
    expect(res.status).toBe(200);

    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/better-auth\.session_token=/);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    expect(setCookie).toMatch(/Path=\//i);
    // Host-only: no Domain attribute must be present.
    expect(setCookie).not.toMatch(/Domain=/i);
  });

  it("rejects invalid credentials", async () => {
    const res = await app.request(
      "/api/auth/sign-in/email",
      {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ email: USER.email, password: "wrong-password" }),
      },
      bindings,
    );
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  it("validates the session, then invalidates it on logout", async () => {
    // 1. Sign in → capture cookie.
    const signIn = await app.request(
      "/api/auth/sign-in/email",
      {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ email: USER.email, password: USER.password }),
      },
      bindings,
    );
    const cookie = sessionCookieFrom(signIn);
    expect(cookie).toBeTruthy();

    // 2. Session endpoint (portal contract path /api/auth/session, aliased to
    //    Better Auth's get-session) reflects the logged-in user.
    const session = await app.request(
      "/api/auth/session",
      { headers: { Cookie: cookie! } },
      bindings,
    );
    expect(session.status).toBe(200);
    const sessionBody = (await session.json()) as { user?: { email?: string } } | null;
    expect(sessionBody?.user?.email).toBe(USER.email);

    // 3. Logout.
    const logout = await app.request(
      "/api/auth/sign-out",
      { method: "POST", headers: { Cookie: cookie!, Origin: PORTAL } },
      bindings,
    );
    expect(logout.status).toBe(200);

    // 4. After logout, the session is gone.
    const afterLogout = await app.request(
      "/api/auth/session",
      { headers: { Cookie: cookie! } },
      bindings,
    );
    const afterLogoutBody = (await afterLogout.json().catch(() => null)) as {
      user?: unknown;
    } | null;
    expect(afterLogoutBody?.user).toBeFalsy();
  });
});
