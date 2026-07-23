import { drizzle } from "drizzle-orm/d1";
import { schema } from "./schema";

export type Database = ReturnType<typeof createDb>;

/**
 * Build a Drizzle client over the request-scoped D1 binding. D1 has no
 * connection pool — the binding is created per request by the runtime, so we
 * construct the client per request rather than caching a global.
 */
export function createDb(d1: D1Database) {
  return drizzle(d1, { schema });
}
