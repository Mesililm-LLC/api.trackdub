import { defineConfig } from "drizzle-kit";

/**
 * Drizzle Kit config for the activation Worker's D1 (separate database from
 * the portal's). Generates SQL migrations from src/activation/schema.ts into
 * ./drizzle-activation, which is also the `migrations_dir` in
 * wrangler.activation*.jsonc.
 */
export default defineConfig({
  dialect: "sqlite",
  driver: "d1-http",
  schema: "./src/activation/schema.ts",
  out: "./drizzle-activation",
});
