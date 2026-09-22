import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";
import path from "node:path";
import { TEST_SIGNING_KEY_PEM } from "./test/activation/test-keys";

/**
 * Runs the activation Worker's tests inside the real workerd runtime, using
 * bindings from wrangler.activation.jsonc. Separate from vitest.config.ts
 * (the portal's) because the two Workers have entirely disjoint bindings and
 * migrations dirs — see src/activation/types.ts.
 *
 * The signing keypair lives in test/activation/test-keys.ts, a plain module
 * with no vite/vitest-pool-workers imports, so test files (which run inside
 * workerd) can import the public half without pulling Node-only build
 * tooling into the worker bundle.
 */
export default defineConfig(async () => {
  const migrations = await readD1Migrations(path.join(__dirname, "drizzle-activation"));

  return {
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "src"),
      },
    },
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.activation.jsonc" },
        poolOptions: {
          bindings: {
            APP_ENV: "development",
            ACTIVATION_ISSUER: "https://activate.trackdub.com",
            ACTIVATION_AUDIENCE: "trackdub-license-prod",
            SIGNING_KEY_ID: "test-key-2026",
            SIGNING_KEY: TEST_SIGNING_KEY_PEM,
            ADMIN_API_TOKEN: "test-admin-token-at-least-16-chars-long",
            ALLOW_DEV_LICENSES: "true",
            TEST_MIGRATIONS: migrations,
          },
        },
      }),
    ],
    test: {
      globals: true,
      setupFiles: ["./test/activation/apply-migrations.ts"],
      include: ["test/activation/**/*.test.ts"],
    },
  };
});
