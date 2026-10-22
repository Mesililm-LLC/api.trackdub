/**
 * Apply SQL migrations to the database the task is configured for. Run as a
 * one-off task before (or as part of) a deploy:
 *
 *   SERVICE=api         -> migrations/portal
 *   SERVICE=activation  -> migrations/activation
 *
 *   bun run server/migrate.ts
 *
 * Uses the same DATABASE_* variables as the service, so the application role
 * must own its database (see infra/README.md for the bootstrap SQL).
 */
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { connectFromEnv } from "./postgres";
import { exit, processEnv } from "./process";

const service = processEnv.SERVICE ?? "api";
const folders: Record<string, string> = {
  api: "./migrations/portal",
  activation: "./migrations/activation",
};
const migrationsFolder = folders[service];
if (!migrationsFolder) {
  console.error(`SERVICE must be one of: ${Object.keys(folders).join(", ")} (got "${service}")`);
  exit(1);
}

const client = connectFromEnv({ ...processEnv, DATABASE_POOL_MAX: "1" });
if (!client) {
  console.error("DATABASE_HOST, DATABASE_NAME and DATABASE_USER must be set");
  exit(1);
}

try {
  await migrate(drizzle(client), { migrationsFolder });
  console.log(JSON.stringify({ level: "info", msg: "migrations applied", service, migrationsFolder }));
} catch (err) {
  console.error(JSON.stringify({ level: "error", msg: "migration failed", error: String(err) }));
  exit(1);
} finally {
  await client.end({ timeout: 5 });
}
