import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Portal API tests. Run in Node against an in-process PostgreSQL (PGlite) and
 * an in-memory object store, wired in through test/support/portal-env.ts.
 *
 * The activation Worker stays on Cloudflare (D1) and keeps its own workerd
 * based config (vitest.activation.config.ts).
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
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
