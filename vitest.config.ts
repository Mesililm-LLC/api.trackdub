import { defineWorkersConfig, readD1Migrations } from "@cloudflare/vitest-pool-workers/config";
import path from "node:path";

/**
 * Runs tests inside the real workerd runtime via vitest-pool-workers, with
 * bindings from wrangler.jsonc. Migrations are read from ./drizzle at config
 * time (Node context) and injected as `TEST_MIGRATIONS`; a setup hook applies
 * them to the isolated per-run D1 so auth flows hit a real SQLite schema.
 */
export default defineWorkersConfig(async () => {
  const migrations = await readD1Migrations(path.join(__dirname, "drizzle"));

  return {
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "src"),
      },
    },
    test: {
      globals: true,
      setupFiles: ["./test/apply-migrations.ts"],
      poolOptions: {
        workers: {
          singleWorker: true,
          wrangler: { configPath: "./wrangler.jsonc" },
          miniflare: {
            bindings: {
              APP_ENV: "development",
              PORTAL_ORIGIN: "https://portal.trackdub.com",
              BETTER_AUTH_SECRET: "test-secret-value-at-least-16-chars-long",
              ADMIN_API_TOKEN: "test-admin-token-at-least-16-chars-long",
              TEST_MIGRATIONS: migrations,
            },
          },
        },
      },
    },
  };
});
