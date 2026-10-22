import type { ColumnSpec, TableSpec } from "./tables";

export type SourceRow = Record<string, unknown>;
export type TargetValue = string | number | boolean | Date | null;
export type TargetRow = Record<string, TargetValue>;

const SQLITE_DATETIME = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?$/;

/**
 * Parse a stored timestamp string. SQLite's `datetime('now')` writes
 * `YYYY-MM-DD HH:MM:SS` in UTC with no zone marker, which JavaScript would
 * read as local time, so it is tagged as UTC explicitly. Strings that already
 * carry a zone (ISO-8601 with `Z` or an offset) are parsed as written.
 */
export function parseStoredTimestamp(value: string): Date {
  const iso = SQLITE_DATETIME.test(value) ? `${value.replace(" ", "T")}Z` : value;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`unparseable timestamp: ${JSON.stringify(value)}`);
  }
  return date;
}

export function convertValue(column: ColumnSpec, table: string, raw: unknown): TargetValue {
  const where = `${table}.${column.name}`;

  if (raw === null || raw === undefined) {
    if (column.nullable) return null;
    throw new Error(`${where} is NULL but the column is NOT NULL`);
  }

  switch (column.kind) {
    case "text":
      if (typeof raw !== "string") throw new Error(`${where} expected text, got ${typeof raw}`);
      return raw;
    case "int":
      if (typeof raw !== "number" || !Number.isInteger(raw)) {
        throw new Error(`${where} expected an integer, got ${JSON.stringify(raw)}`);
      }
      return raw;
    case "bool":
      if (raw === 0 || raw === false) return false;
      if (raw === 1 || raw === true) return true;
      throw new Error(`${where} expected 0/1, got ${JSON.stringify(raw)}`);
    case "epochMs":
      if (typeof raw !== "number" || !Number.isFinite(raw)) {
        throw new Error(`${where} expected epoch milliseconds, got ${JSON.stringify(raw)}`);
      }
      return new Date(raw);
    case "isoText":
      if (typeof raw !== "string") throw new Error(`${where} expected a timestamp string, got ${typeof raw}`);
      return parseStoredTimestamp(raw);
  }
}

export function convertRow(spec: TableSpec, row: SourceRow): TargetRow {
  const out: TargetRow = {};
  for (const column of spec.columns) {
    if (!(column.name in row)) {
      throw new Error(`${spec.table}.${column.name} is missing from the exported row`);
    }
    out[column.name] = convertValue(column, spec.table, row[column.name]);
  }
  return out;
}
