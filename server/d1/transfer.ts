import { createHash } from "node:crypto";
import type { SqlDatabase } from "@/platform/sql";
import { convertRow, type SourceRow, type TargetRow } from "./convert";
import type { TableSpec } from "./tables";

export type TableData = Record<string, SourceRow[]>;

export interface TableReport {
  table: string;
  sourceRows: number;
  targetRows: number;
  sourceHash: string;
  targetHash: string;
  ok: boolean;
}

export interface TransferReport {
  tables: TableReport[];
  ok: boolean;
  /** True only when the import ran without `dryRun` and every table verified. */
  committed: boolean;
}

/** Thrown inside the transaction to roll it back while still returning the report. */
class RollbackWithReport extends Error {
  constructor(readonly report: TransferReport) {
    super("rollback");
  }
}

const quote = (identifier: string) => `"${identifier.replace(/"/g, '""')}"`;

function canonicalLine(spec: TableSpec, row: TargetRow): string {
  return JSON.stringify(
    spec.columns.map((c) => {
      const value = row[c.name];
      return value instanceof Date ? value.getTime() : value;
    }),
  );
}

/**
 * Order-independent digest of a table: sorted canonical lines, so the check
 * does not depend on how SQLite and PostgreSQL collate the ordering column.
 */
function digest(spec: TableSpec, rows: TargetRow[]): string {
  const lines = rows.map((r) => canonicalLine(spec, r)).sort();
  return createHash("sha256").update(lines.join("\n")).digest("hex");
}

async function assertTargetEmpty(tx: SqlDatabase, specs: TableSpec[]): Promise<void> {
  for (const spec of specs) {
    const row = await tx
      .prepare(`SELECT COUNT(*)::int AS n FROM ${quote(spec.table)}`)
      .first<{ n: number }>();
    if ((row?.n ?? 0) > 0) {
      throw new Error(
        `target table "${spec.table}" already has ${row!.n} row(s); refusing to import into a non-empty database`,
      );
    }
  }
}

async function insertRows(tx: SqlDatabase, spec: TableSpec, rows: TargetRow[]): Promise<void> {
  const columns = spec.columns.map((c) => quote(c.name)).join(", ");
  const placeholders = spec.columns.map(() => "?").join(", ");
  const sql = `INSERT INTO ${quote(spec.table)} (${columns}) VALUES (${placeholders})`;
  for (const row of rows) {
    await tx.prepare(sql).bind(...spec.columns.map((c) => row[c.name])).run();
  }
}

async function readBack(tx: SqlDatabase, spec: TableSpec): Promise<TargetRow[]> {
  const columns = spec.columns.map((c) => quote(c.name)).join(", ");
  const { results } = await tx.prepare(`SELECT ${columns} FROM ${quote(spec.table)}`).all<TargetRow>();
  return results;
}

/**
 * Load exported D1 rows into PostgreSQL in one transaction, then read every
 * table back and compare row counts and content digests with the source. The
 * transaction commits only if everything matches and `dryRun` is false.
 *
 * Conversion runs before the transaction opens, so malformed source data
 * fails without touching the database.
 */
export async function transfer(
  db: SqlDatabase,
  specs: TableSpec[],
  data: TableData,
  options: { dryRun: boolean },
): Promise<TransferReport> {
  const converted = specs.map((spec) => ({
    spec,
    rows: (data[spec.table] ?? []).map((row) => convertRow(spec, row)),
  }));

  try {
    return await db.transaction(async (tx) => {
      await assertTargetEmpty(tx, specs);
      for (const { spec, rows } of converted) await insertRows(tx, spec, rows);

      const tables: TableReport[] = [];
      for (const { spec, rows } of converted) {
        const back = await readBack(tx, spec);
        const sourceHash = digest(spec, rows);
        const targetHash = digest(spec, back);
        tables.push({
          table: spec.table,
          sourceRows: rows.length,
          targetRows: back.length,
          sourceHash,
          targetHash,
          ok: rows.length === back.length && sourceHash === targetHash,
        });
      }

      const ok = tables.every((t) => t.ok);
      if (!ok || options.dryRun) {
        throw new RollbackWithReport({ tables, ok, committed: false });
      }
      return { tables, ok, committed: true };
    });
  } catch (err) {
    if (err instanceof RollbackWithReport) return err.report;
    throw err;
  }
}
