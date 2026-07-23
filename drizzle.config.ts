import { defineConfig } from "drizzle-kit";

/**
 * Drizzle Kit config. Generates SQL migrations from src/db/schema.ts into
 * ./drizzle, which is also the Wrangler `migrations_dir` so `wrangler d1
 * migrations apply` runs them against D1.
 */
export default defineConfig({
  dialect: "sqlite",
  driver: "d1-http",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
});
