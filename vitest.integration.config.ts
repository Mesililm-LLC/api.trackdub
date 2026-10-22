import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Integration tests that need a real PostgreSQL server (TEST_DATABASE_URL).
 * They skip themselves when it is not set, so `bun run test:integration` is
 * safe to run anywhere. Separate from the unit suites, which use PGlite.
 */
export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
  },
  test: {
    environment: "node",
    include: ["test/integration/**/*.test.ts"],
    testTimeout: 30_000,
  },
});
