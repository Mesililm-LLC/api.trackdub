/**
 * Stand-in for the module activation tests import as `cloudflare:test`
 * (aliased in vitest.activation.config.ts). Exposes the `env` the activation
 * service tests run against, backed by an in-process PostgreSQL.
 */
import { PGlite } from "@electric-sql/pglite";
import path from "node:path";
import type { ActivationBindings } from "@/activation/types";
import { TEST_SIGNING_KEY_PEM } from "../activation/test-keys";
import { applyMigrations, createPgliteSql } from "./pglite";

const pg = new PGlite();

export const env: ActivationBindings = {
  APP_ENV: "development",
  ACTIVATION_ISSUER: "https://activate.trackdub.com",
  ACTIVATION_AUDIENCE: "trackdub-license-prod",
  SIGNING_KEY_ID: "test-key-2026",
  SIGNING_KEY: TEST_SIGNING_KEY_PEM,
  ADMIN_API_TOKEN: "test-admin-token-at-least-16-chars-long",
  ALLOW_DEV_LICENSES: "true",
  DB: createPgliteSql(pg),
};

export async function migrate(): Promise<void> {
  await applyMigrations(pg, path.resolve(import.meta.dirname, "../../migrations/activation"));
}
