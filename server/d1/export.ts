import { EXPORT_OPTIONAL_TABLES, type D1Source } from "./tables";
import type { SourceRow } from "./convert";
import type { TableData } from "./transfer";

const PAGE_SIZE = 5000;

interface D1QueryResponse {
  success: boolean;
  errors?: { message: string }[];
  result?: { results?: SourceRow[]; success?: boolean }[];
}

export interface ExportOptions {
  accountId: string;
  apiToken: string;
  source: D1Source;
  /** Injected in tests. */
  fetchImpl?: typeof fetch;
}

async function query(options: ExportOptions, sql: string): Promise<SourceRow[]> {
  const doFetch = options.fetchImpl ?? fetch;
  const url = `https://api.cloudflare.com/client/v4/accounts/${options.accountId}/d1/database/${options.source.databaseId}/query`;
  const res = await doFetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${options.apiToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ sql }),
  });
  const body = (await res.json()) as D1QueryResponse;
  if (!res.ok || !body.success) {
    const message = (body.errors ?? []).map((e) => e.message).join("; ") || `HTTP ${res.status}`;
    throw new Error(message);
  }
  return body.result?.[0]?.results ?? [];
}

/**
 * Read every table of a D1 database through Cloudflare's query API. Read-only:
 * only SELECT statements are issued. Columns are listed explicitly, so a
 * schema that has drifted from server/d1/tables.ts fails loudly instead of
 * exporting something the importer would misread.
 */
export async function exportD1(options: ExportOptions): Promise<TableData> {
  const data: TableData = {};
  for (const spec of options.source.tables) {
    const columns = spec.columns.map((c) => `"${c.name}"`).join(", ");
    const rows: SourceRow[] = [];
    try {
      for (let offset = 0; ; offset += PAGE_SIZE) {
        const page = await query(
          options,
          `SELECT ${columns} FROM "${spec.table}" ORDER BY "${spec.orderBy}" LIMIT ${PAGE_SIZE} OFFSET ${offset}`,
        );
        rows.push(...page);
        if (page.length < PAGE_SIZE) break;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (EXPORT_OPTIONAL_TABLES.has(spec.table) && /no such table/i.test(message)) continue;
      throw new Error(`exporting ${spec.table}: ${message}`);
    }
    data[spec.table] = rows;
  }
  return data;
}
