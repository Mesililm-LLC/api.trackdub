/**
 * In-process PostgreSQL (PGlite) behind the same interfaces production uses,
 * so the route, auth, and activation tests run real SQL (including the seat
 * accounting statements and Better Auth's queries) with no external database.
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import type { Database, OrmDatabase } from "@/db/client";
import { schema } from "@/db/schema";
import { createSqlDatabase, type QueryFn, type SqlDatabase } from "@/platform/sql";

type Queryable = Pick<PGlite, "query">;

function queryOn(db: Queryable): QueryFn {
  return async (text, params) => {
    const result = await db.query<Record<string, unknown>>(text, params);
    return { rows: result.rows, changes: result.affectedRows ?? 0 };
  };
}

export function createPgliteSql(pg: PGlite): SqlDatabase {
  return createSqlDatabase(queryOn(pg), (fn) => pg.transaction((tx) => fn(queryOn(tx))));
}

export function createPgliteDatabase(pg: PGlite): Database {
  return {
    ...createPgliteSql(pg),
    orm: drizzle(pg, { schema }) as unknown as OrmDatabase,
  };
}

/** Apply a generated migrations folder (`migrations/portal` or `migrations/activation`). */
export async function applyMigrations(pg: PGlite, migrationsFolder: string): Promise<void> {
  await migrate(drizzle(pg), { migrationsFolder });
}
