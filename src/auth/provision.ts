import type { Auth } from "@/auth";

export interface ProvisionInput {
  email: string;
  name: string;
  /** Temporary password; the invitee replaces it via the reset flow. */
  tempPassword: string;
}

export interface ProvisionedUser {
  id: string;
  email: string;
}

/**
 * Server-side, operator-triggered user creation for invite-only registration.
 *
 * Public sign-up is disabled, and Better Auth's sign-up route (even via the
 * server API) throws when `disableSignUp` is true. Provisioning therefore goes
 * through the internal context — mirroring exactly what the sign-up route does:
 * hash the password, create the user, then link a `credential` account. No
 * session is created here; the invitee authenticates after setting a password.
 *
 * Throws if the email already exists.
 */
export async function provisionUser(auth: Auth, input: ProvisionInput): Promise<ProvisionedUser> {
  const ctx = await auth.$context;
  const email = input.email.toLowerCase();

  const existing = await ctx.internalAdapter.findUserByEmail(email);
  if (existing) {
    throw new Error("A user with this email already exists");
  }

  const hash = await ctx.password.hash(input.tempPassword);
  const createdUser = await ctx.internalAdapter.createUser({
    email,
    name: input.name,
    emailVerified: false,
  });

  await ctx.internalAdapter.linkAccount({
    userId: createdUser.id,
    providerId: "credential",
    accountId: createdUser.id,
    password: hash,
  });

  return { id: createdUser.id, email: createdUser.email };
}
