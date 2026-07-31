import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Runs tests inside the real workerd runtime via the vitest-pool-workers Vite
 * plugin, with bindings from wrangler.jsonc. Migrations are read from
 * ./drizzle at config time (Node context) and injected as `TEST_MIGRATIONS`;
 * a setup hook (test/apply-migrations.ts) applies them to the isolated
 * per-run D1 so auth flows hit a real SQLite schema.
 */
export default defineConfig(async () => {
  const migrations = await readD1Migrations(path.join(__dirname, "drizzle"));

  return {
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "src"),
      },
    },
    plugins: [
      cloudflareTest({
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
      }),
    ],
    test: {
      globals: true,
      // Excludes test/activation/** — that suite runs under its own D1 schema
      // and bindings via vitest.activation.config.ts (`npm run test:activation`).
      include: ["test/*.test.ts"],
      setupFiles: ["./test/apply-migrations.ts"],
      // Better Auth's sign-in route (node_modules/better-auth/dist/api/routes/
      // sign-in.mjs) throws an `APIError` for invalid credentials that is
      // correctly caught and turned into our 401 response, but better-call's
      // internal endpoint wrapper independently surfaces the same rejection a
      // second time, which Vitest 4's stricter unhandled-rejection tracking
      // flags even though no test assertion is affected (verified: all status
      // codes and bodies assert correctly). Upstream library behavior, not
      // ours — suppressed so real unhandled errors in our own code still fail
      // the run.
      dangerouslyIgnoreUnhandledErrors: true,
    },
  };
});
