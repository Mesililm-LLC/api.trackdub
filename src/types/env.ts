import type { Session, User } from "better-auth/types";
import type { Database } from "@/db/client";
import type { ObjectStore } from "@/platform/objects";

/**
 * Runtime bindings + injected vars available on `env`. On AWS these come from
 * `server/bindings.ts` (PostgreSQL, S3) and the task definition's environment
 * and secrets; tests build them in `test/support/`.
 */
export interface Bindings {
  // --- Platform bindings ---
  DB: Database;
  MEDIA: ObjectStore;

  // --- Public configuration (task definition environment) ---
  APP_ENV: string;
  PORTAL_ORIGIN: string;
  /** Set to "true" only while a real dub queue consumer is deployed. */
  DUB_PROCESSOR_ENABLED?: string;

  // --- Secrets (.dev.vars locally, Secrets Manager when deployed) ---
  BETTER_AUTH_SECRET: string;
  ADMIN_API_TOKEN: string;
  /** Optional — when absent, password-reset emails are logged but not sent. */
  RESEND_API_KEY?: string;

  // --- Injected at build/deploy time (optional) ---
  /** Image tag / commit the running container was built from. */
  GIT_SHA?: string;
  /** CI build identifier, when available. */
  BUILD_ID?: string;
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
