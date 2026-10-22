import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Portal API tests. Run in Node against an in-process PostgreSQL (PGlite) and
 * an in-memory object store, wired in through test/support/portal-env.ts.
 *
 * Existing tests import their runtime environment from `cloudflare:test`
 * (the module the old workerd pool provided); that specifier is aliased to the
 * support module instead of being rewritten in every test file.
 *
 * The activation service has its own config (vitest.activation.config.ts):
 * the two services have disjoint bindings and migrations.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "cloudflare:test": path.resolve(import.meta.dirname, "test/support/portal-env.ts"),
    },
  },
  test: {
    environment: "node",
    // Each test file boots its own in-process PostgreSQL (WASM); cap parallelism
    // so memory-constrained machines do not run out of commit.
    maxWorkers: 3,
    include: ["test/*.test.ts"],
    setupFiles: ["./test/setup/portal.ts"],
  },
});
