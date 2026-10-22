import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Activation service tests. Run in Node against an in-process PostgreSQL
 * (PGlite), wired in through test/support/activation-env.ts and the
 * `cloudflare:test` alias (see vitest.config.ts for why the alias exists).
 *
 * The signing keypair lives in test/activation/test-keys.ts, a plain module
 * shared by the environment and the tests that verify issued tokens.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "cloudflare:test": path.resolve(import.meta.dirname, "test/support/activation-env.ts"),
    },
  },
  test: {
    environment: "node",
    // Each test file boots its own in-process PostgreSQL (WASM); cap parallelism
    // so memory-constrained machines do not run out of commit.
    maxWorkers: 3,
    globals: true,
    include: ["test/activation/**/*.test.ts"],
    setupFiles: ["./test/setup/activation.ts"],
  },
});
