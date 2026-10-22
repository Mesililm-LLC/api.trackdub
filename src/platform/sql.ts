/**
 * Minimal SQL surface the application depends on.
 *
 * The activation service writes its seat-accounting SQL by hand (the
 * concurrency predicates are load-bearing), and the portal's health probe runs
 * a couple of raw statements. Both go through this interface instead of a
 * specific driver, so production can use postgres.js and tests can use an
 * in-process PostgreSQL (PGlite) without changing any route code.
 *
 * The shape deliberately mirrors the `prepare().bind().first()/all()/run()`
 * calls the code already made against Cloudflare D1, with `?` placeholders.
 * Placeholders are rewritten to PostgreSQL's `$n` form here, so statements
 * stay readable at the call site.
 */

export interface SqlRunResult {
  meta: { changes: number };
}

export interface SqlStatement {
  bind(...values: unknown[]): SqlStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<SqlRunResult>;
}

export interface SqlDatabase {
  prepare(sql: string): SqlStatement;
  /**
   * Run `fn` in a single transaction. Rolls back if `fn` throws. The `tx`
   * handle must be used for every statement inside the callback.
   */
  transaction<T>(fn: (tx: SqlDatabase) => Promise<T>): Promise<T>;
}

export interface QueryResult {
  rows: Record<string, unknown>[];
  /** Rows affected by INSERT / UPDATE / DELETE. */
  changes: number;
}

/** Driver hook: execute one statement with already-positional (`$n`) parameters. */
export type QueryFn = (text: string, params: unknown[]) => Promise<QueryResult>;

/** Driver hook: run `fn` inside a transaction, handing it a transaction-scoped {@link QueryFn}. */
export type TransactionFn = <T>(fn: (query: QueryFn) => Promise<T>) => Promise<T>;

/**
 * Rewrite `?` placeholders to `$1, $2, ...`. Question marks inside single
 * quoted string literals, double quoted identifiers, and `--` comments are
 * left alone.
 */
export function toPositionalParams(sql: string): string {
  let out = "";
  let index = 0;
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i]!;
    if (ch === "'" || ch === '"') {
      const end = sql.indexOf(ch, i + 1);
      const stop = end === -1 ? sql.length : end + 1;
      out += sql.slice(i, stop);
      i = stop;
    } else if (ch === "-" && sql[i + 1] === "-") {
      const end = sql.indexOf("\n", i);
      const stop = end === -1 ? sql.length : end;
      out += sql.slice(i, stop);
      i = stop;
    } else if (ch === "?") {
      index += 1;
      out += `$${index}`;
      i += 1;
    } else {
      out += ch;
      i += 1;
    }
  }
  return out;
}

function statement(query: QueryFn, sql: string, params: unknown[]): SqlStatement {
  const text = toPositionalParams(sql);
  return {
    bind: (...values) => statement(query, sql, values),
    first: async <T>() => {
      const { rows } = await query(text, params);
      return (rows[0] as T | undefined) ?? null;
    },
    all: async <T>() => {
      const { rows } = await query(text, params);
      return { results: rows as T[] };
    },
    run: async () => {
      const { changes } = await query(text, params);
      return { meta: { changes } };
    },
  };
}

/** Build a {@link SqlDatabase} from a driver's query and transaction hooks. */
export function createSqlDatabase(query: QueryFn, transaction: TransactionFn): SqlDatabase {
  return {
    prepare: (sql) => statement(query, sql, []),
    transaction: (fn) => transaction((txQuery) => fn(createSqlDatabase(txQuery, transaction))),
  };
}
