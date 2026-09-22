import { betterAuth, type BetterAuthOptions } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { createDb } from "@/db/client";
import { schema } from "@/db/schema";
import { loadConfig } from "@/config/env";
import { sendPasswordResetEmail } from "@/lib/mail";
import type { Bindings } from "@/types/env";

export type Auth = ReturnType<typeof createAuth>;

/**
 * Build a Better Auth instance for the current request.
 *
 * Cookie strategy — host-only sessions on api.trackdub.com:
 *   - `baseURL` is intentionally omitted so Better Auth derives the origin from
 *     request headers. Combined with `crossSubDomainCookies` left DISABLED,
 *     this yields a host-only cookie (no `Domain` attribute) scoped to
 *     api.trackdub.com only.
 *   - Attributes are Secure; HttpOnly; SameSite=Lax; Path=/ — never readable by
 *     portal JavaScript.
 *
 * Registration is invite-only: `disableSignUp: true` removes the public
 * sign-up endpoint. Users are provisioned via the guarded admin invite path
 * (see routes/admin) and set their own password through the reset flow.
 */
export function createAuth(env: Bindings) {
  const config = loadConfig(env);
  const db = createDb(env.DB);

  const options: BetterAuthOptions = {
    secret: config.secrets.BETTER_AUTH_SECRET,
    database: drizzleAdapter(db, { provider: "sqlite", schema }),
    // No baseURL: derive origin from headers so cookies stay host-only.
    trustedOrigins: config.allowedOrigins,
    emailAndPassword: {
      enabled: true,
      disableSignUp: true, // invite-only
      requireEmailVerification: false,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        // Token is never logged — only the recipient and (in non-prod) the URL.
        await sendPasswordResetEmail(
          { to: user.email, userName: user.name ?? null, resetUrl: url },
          env.RESEND_API_KEY,
        );
      },
    },
    advanced: {
      // crossSubDomainCookies intentionally NOT enabled → host-only cookie.
      defaultCookieAttributes: {
        secure: true,
        httpOnly: true,
        sameSite: "lax",
        path: "/",
      },
    },
  };

  return betterAuth(options);
}
