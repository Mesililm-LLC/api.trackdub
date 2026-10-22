/**
 * PostgreSQL driver wiring (postgres.js) for the container runtime.
 *
 * `createPostgresSql` backs the raw-SQL surface (`SqlDatabase`, used by the
 * health checks); `createPostgresDatabase` adds the Drizzle client the portal
 * API needs. Connections are opened lazily by postgres.js, so the process starts
 * (and answers `/healthz`) even while the database is unreachable.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import type { Database, OrmDatabase } from "@/db/client";
import { schema } from "@/db/schema";
import { createSqlDatabase, type QueryFn, type SqlDatabase } from "@/platform/sql";

type Executor = postgres.Sql | postgres.TransactionSql;

function queryOn(executor: Executor): QueryFn {
  return async (text, params) => {
    const rows = await executor.unsafe(text, params as postgres.ParameterOrJSON<never>[]);
    return { rows: [...rows] as Record<string, unknown>[], changes: rows.count ?? 0 };
  };
}

export function createPostgresSql(client: postgres.Sql): SqlDatabase {
  return createSqlDatabase(queryOn(client), (fn) =>
    client.begin(async (tx) => fn(queryOn(tx))) as ReturnType<typeof fn>,
  );
}

export function createPostgresDatabase(client: postgres.Sql): Database {
  return {
    ...createPostgresSql(client),
    orm: drizzle(client, { schema }) as unknown as OrmDatabase,
  };
}

export interface PostgresEnv {
  DATABASE_HOST?: string | undefined;
  DATABASE_PORT?: string | undefined;
  DATABASE_NAME?: string | undefined;
  DATABASE_USER?: string | undefined;
  DATABASE_PASSWORD?: string | undefined;
  /** `require` (default, TLS without CA verification) or `disable` (local development only). */
  DATABASE_SSL?: string | undefined;
  /** Pool size per task. Defaults to 10. */
  DATABASE_POOL_MAX?: string | undefined;
}

/** Build a postgres.js client from the task environment, or null when no database is configured. */
export function connectFromEnv(env: PostgresEnv): postgres.Sql | null {
  if (!env.DATABASE_HOST || !env.DATABASE_NAME || !env.DATABASE_USER) return null;
  return postgres({
    host: env.DATABASE_HOST,
    port: Number(env.DATABASE_PORT ?? 5432),
    database: env.DATABASE_NAME,
    username: env.DATABASE_USER,
    password: env.DATABASE_PASSWORD,
    ssl: env.DATABASE_SSL === "disable" ? false : "require",
    max: Number(env.DATABASE_POOL_MAX ?? 10),
    onnotice: () => {},
  });
}
