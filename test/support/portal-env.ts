/**
 * Stand-in for the module tests import as `cloudflare:test` (aliased in
 * vitest.config.ts). Exposes the `env` the portal API tests run against: test
 * configuration, an in-process PostgreSQL, and an in-memory object store.
 */
import { PGlite } from "@electric-sql/pglite";
import path from "node:path";
import type { Bindings } from "@/types/env";
import { MemoryObjectStore } from "./memory-objects";
import { applyMigrations, createPgliteDatabase } from "./pglite";

const pg = new PGlite();

export const env: Bindings = {
  APP_ENV: "development",
  PORTAL_ORIGIN: "https://portal.trackdub.com",
  BETTER_AUTH_SECRET: "test-secret-value-at-least-16-chars-long",
  ADMIN_API_TOKEN: "test-admin-token-at-least-16-chars-long",
  DB: createPgliteDatabase(pg),
  MEDIA: new MemoryObjectStore(),
};

export async function migrate(): Promise<void> {
  await applyMigrations(pg, path.resolve(import.meta.dirname, "../../migrations/portal"));
}
