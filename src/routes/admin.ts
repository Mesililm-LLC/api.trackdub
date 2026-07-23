import { Hono } from "hono";
import { z } from "zod";
import { createAuth } from "@/auth";
import { provisionUser } from "@/auth/provision";
import { requireAdminToken } from "@/middleware/authorize";
import { validate } from "@/middleware/validate";
import { ApiError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import type { AppEnv } from "@/types/env";

/**
 * Operator-only provisioning for invite-only registration.
 *
 * Public sign-up is disabled (`disableSignUp: true`). An operator holding
 * `ADMIN_API_TOKEN` invites a user here.
 *
 * Two modes:
 *   - Normal invite (no `password`): create the account with a random
 *     throwaway password and start the reset flow so the invitee sets their
 *     own. No user password is transmitted to us.
 *   - Bootstrap/seed (`password` provided): set an initial password directly.
 *     Intended for seeding the first operator before email delivery exists
 *     (PR1 ships no email provider). Use over TLS with the admin token only.
 */
export const admin = new Hono<AppEnv>();

const inviteSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(200),
  password: z.string().min(12).max(200).optional(),
});

admin.post("/invite", requireAdminToken, validate("json", inviteSchema), async (c) => {
  const { email, name, password } = c.get("valid_json");
  const auth = createAuth(c.env);

  // Use the operator-provided password when seeding, otherwise a throwaway that
  // the invitee replaces via the reset link.
  const tempPassword = password ?? crypto.randomUUID() + crypto.randomUUID();

  try {
    await provisionUser(auth, { email, name, tempPassword });
  } catch (err) {
    logger.warn("invite failed", {
      requestId: c.get("requestId"),
      message: err instanceof Error ? err.message : String(err),
    });
    throw ApiError.badRequest("Could not create invite (email may already exist)");
  }

  // Only start the reset flow for real invites; a seeded password is usable now.
  if (!password) {
    await auth.api.requestPasswordReset({
      body: { email, redirectTo: `${c.env.PORTAL_ORIGIN}/reset-password` },
      headers: c.req.raw.headers,
    });
  }

  return c.json({ invited: true, email, seeded: Boolean(password) }, 201);
});
