import { env, applyD1Migrations } from "cloudflare:test";
import { beforeAll } from "vitest";

/**
 * Global setup: apply the activation Worker's SQL migrations to the isolated
 * test D1 once, using the migrations read at config time and injected as
 * `TEST_MIGRATIONS`. Mirrors test/apply-migrations.ts for the portal.
 */
beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});
