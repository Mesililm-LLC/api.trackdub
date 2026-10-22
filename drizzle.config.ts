import { defineConfig } from "drizzle-kit";

/**
 * Drizzle Kit config for the portal API's PostgreSQL database. Generates SQL
 * migrations from src/db/schema.ts into ./migrations/portal, which
 * `server/migrate.ts` applies at deploy time.
 *
 * The earlier Cloudflare D1 (SQLite) migrations remain in ./drizzle for
 * reference when exporting data from D1; they are not applied to PostgreSQL.
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./migrations/portal",
});
