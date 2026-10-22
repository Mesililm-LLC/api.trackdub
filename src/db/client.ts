import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { SqlDatabase } from "@/platform/sql";
import type { schema } from "./schema";

/** Drizzle client over the portal schema, independent of the PostgreSQL driver. */
export type OrmDatabase = PgDatabase<PgQueryResultHKT, typeof schema>;

/**
 * The portal's `DB` binding: raw SQL (health probe) plus the Drizzle client
 * used by auth and the dub job routes. Built once per process by the runtime
 * (`server/bindings.ts`); tests build one over an in-process PostgreSQL.
 */
export interface Database extends SqlDatabase {
  readonly orm: OrmDatabase;
}

export function createDb(db: Database): OrmDatabase {
  return db.orm;
}
