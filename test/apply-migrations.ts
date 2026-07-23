import { env, applyD1Migrations } from "cloudflare:test";
import { beforeAll } from "vitest";

/**
 * Global setup: apply Drizzle SQL migrations to the isolated test D1 once,
 * using the migrations read at config time and injected as `TEST_MIGRATIONS`.
 * This runs inside workerd (no `node:fs`), so we rely on the pool's helper.
 */
beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});
