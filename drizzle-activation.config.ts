import { defineConfig } from "drizzle-kit";

/**
 * Drizzle Kit config for the activation service's PostgreSQL database
 * (separate database from the portal's). Generates SQL migrations from
 * src/activation/schema.ts into ./migrations/activation, which
 * `server/migrate.ts` applies at deploy time.
 *
 * The earlier Cloudflare D1 (SQLite) migrations remain in ./drizzle-activation
 * for reference when exporting data from D1.
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/activation/schema.ts",
  out: "./migrations/activation",
});
