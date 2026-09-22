import type { Session, User } from "better-auth/types";

/**
 * Cloudflare bindings + injected vars available on `env`.
 * Kept in one place so `wrangler.jsonc` and code stay in sync.
 */
export interface Bindings {
  // --- D1 / R2 bindings ---
  DB: D1Database;
  MEDIA: R2Bucket;

  // --- Public configuration (wrangler.jsonc `vars`) ---
  APP_ENV: string;
  PORTAL_ORIGIN: string;

  // --- Secrets (.dev.vars locally, `wrangler secret put` deployed) ---
  BETTER_AUTH_SECRET: string;
  ADMIN_API_TOKEN: string;
  /** Optional — when absent, password-reset emails are logged but not sent. */
  RESEND_API_KEY?: string;

  // --- Injected at build/deploy time (optional) ---
  CF_VERSION_METADATA?: { id: string; tag?: string };
}

/**
 * Per-request values set by middleware and read downstream (Hono `c.var`).
 */
export interface Variables {
  requestId: string;
  session: Session | null;
  user: User | null;
}

export type AppEnv = {
  Bindings: Bindings;
  Variables: Variables;
};
