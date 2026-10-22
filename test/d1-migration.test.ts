import { PGlite } from "@electric-sql/pglite";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { convertRow, convertValue, parseStoredTimestamp } from "../server/d1/convert";
import { exportD1 } from "../server/d1/export";
import { ACTIVATION_TABLES, D1_SOURCES, PORTAL_TABLES } from "../server/d1/tables";
import { transfer, type TableData } from "../server/d1/transfer";
import type { SqlDatabase } from "@/platform/sql";
import { applyMigrations, createPgliteSql } from "./support/pglite";

const root = path.resolve(import.meta.dirname, "..");

async function freshDb(kind: "portal" | "activation"): Promise<{ pg: PGlite; db: SqlDatabase }> {
  const pg = new PGlite();
  await applyMigrations(pg, path.join(root, "migrations", kind));
  return { pg, db: createPgliteSql(pg) };
}

/** Rows shaped the way D1 returns them: SQLite integers, text, `datetime('now')` strings. */
const ACTIVATION_DATA: TableData = {
  licenses: [
    {
      id: "lic-1",
      key_hash: "hash-1",
      tier: "pro",
      buyer_email: "a@example.com",
      status: "active",
      max_machines: 2,
      created_at: "2026-08-01 02:04:40",
    },
    {
      id: "lic-2",
      key_hash: "hash-2",
      tier: "free",
      buyer_email: "b@example.com",
      status: "revoked",
      max_machines: 1,
      created_at: "2026-09-10 12:00:00",
    },
  ],
  activations: [
    {
      id: "act-1",
      license_id: "lic-1",
      fingerprint_hash: "fp-1",
      status: "active",
      activated_at: "2026-08-02T10:15:30.123Z",
      released_at: null,
    },
    {
      id: "act-2",
      license_id: "lic-1",
      fingerprint_hash: "fp-2",
      status: "released",
      activated_at: "2026-08-03T10:15:30.000Z",
      released_at: "2026-08-04T09:00:00.000Z",
    },
  ],
};

describe("timestamp and value conversion", () => {
  it("treats SQLite datetime('now') strings as UTC, not local time", () => {
    expect(parseStoredTimestamp("2026-08-01 02:04:40").toISOString()).toBe("2026-08-01T02:04:40.000Z");
  });

  it("parses ISO strings with a zone as written", () => {
    expect(parseStoredTimestamp("2026-08-02T10:15:30.123Z").toISOString()).toBe("2026-08-02T10:15:30.123Z");
    expect(parseStoredTimestamp("2026-08-02T03:15:30-07:00").toISOString()).toBe("2026-08-02T10:15:30.000Z");
  });

  it("rejects an unparseable timestamp instead of storing garbage", () => {
    expect(() => parseStoredTimestamp("not a date")).toThrow(/unparseable timestamp/);
  });

  it("converts epoch milliseconds, 0/1 booleans, and nulls per column", () => {
    expect(convertValue({ name: "t", kind: "epochMs" }, "x", 1_785_000_000_123)).toEqual(new Date(1_785_000_000_123));
    expect(convertValue({ name: "b", kind: "bool" }, "x", 0)).toBe(false);
    expect(convertValue({ name: "b", kind: "bool" }, "x", 1)).toBe(true);
    expect(convertValue({ name: "n", kind: "text", nullable: true }, "x", null)).toBeNull();
  });

  it("fails loudly on NULL in a NOT NULL column, a wrong type, or a missing column", () => {
    expect(() => convertValue({ name: "n", kind: "text" }, "t", null)).toThrow(/t\.n is NULL/);
    expect(() => convertValue({ name: "i", kind: "int" }, "t", 1.5)).toThrow(/expected an integer/);
    expect(() => convertValue({ name: "b", kind: "bool" }, "t", 2)).toThrow(/expected 0\/1/);
    expect(() => convertRow(ACTIVATION_TABLES[0]!, { id: "x" })).toThrow(/missing from the exported row/);
  });
});

describe("importing activation data", () => {
  let db: SqlDatabase;
  beforeEach(async () => {
    ({ db } = await freshDb("activation"));
  });

  it("loads, verifies, and commits; timestamps land on the same instants", async () => {
    const report = await transfer(db, ACTIVATION_TABLES, ACTIVATION_DATA, { dryRun: false });

    expect(report.ok).toBe(true);
    expect(report.committed).toBe(true);
    expect(report.tables.map((t) => [t.table, t.sourceRows, t.targetRows])).toEqual([
      ["licenses", 2, 2],
      ["activations", 2, 2],
    ]);

    const license = await db
      .prepare("SELECT extract(epoch FROM created_at) * 1000 AS ms FROM licenses WHERE id = ?")
      .bind("lic-1")
      .first<{ ms: number | string }>();
    expect(Number(license!.ms)).toBe(Date.parse("2026-08-01T02:04:40Z"));

    const released = await db
      .prepare("SELECT released_at FROM activations WHERE id = ?")
      .bind("act-2")
      .first<{ released_at: Date }>();
    expect(released!.released_at.toISOString()).toBe("2026-08-04T09:00:00.000Z");
  });

  it("keeps seat accounting intact: active counts match the source per license", async () => {
    await transfer(db, ACTIVATION_TABLES, ACTIVATION_DATA, { dryRun: false });
    const row = await db
      .prepare("SELECT COUNT(*)::int AS n FROM activations WHERE license_id = ? AND status = 'active'")
      .bind("lic-1")
      .first<{ n: number }>();
    expect(row!.n).toBe(1);
  });

  it("dry run verifies everything and then rolls back", async () => {
    const report = await transfer(db, ACTIVATION_TABLES, ACTIVATION_DATA, { dryRun: true });

    expect(report.ok).toBe(true);
    expect(report.committed).toBe(false);
    const row = await db.prepare("SELECT COUNT(*)::int AS n FROM licenses").first<{ n: number }>();
    expect(row!.n).toBe(0);
  });

  it("refuses to import into a database that already has rows", async () => {
    await transfer(db, ACTIVATION_TABLES, ACTIVATION_DATA, { dryRun: false });
    await expect(transfer(db, ACTIVATION_TABLES, ACTIVATION_DATA, { dryRun: false })).rejects.toThrow(
      /already has 2 row\(s\)/,
    );
  });

  it("rolls everything back when the verification digests differ", async () => {
    // A trigger that rewrites a value on insert stands in for any silent
    // corruption between the source rows and what the database stored.
    const { pg, db: tampered } = await freshDb("activation");
    await pg.exec(`
      CREATE FUNCTION corrupt() RETURNS trigger AS $$
      BEGIN NEW.buyer_email := upper(NEW.buyer_email); RETURN NEW; END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER corrupt_email BEFORE INSERT ON licenses FOR EACH ROW EXECUTE FUNCTION corrupt();
    `);

    const report = await transfer(tampered, ACTIVATION_TABLES, ACTIVATION_DATA, { dryRun: false });

    expect(report.ok).toBe(false);
    expect(report.committed).toBe(false);
    expect(report.tables.find((t) => t.table === "licenses")!.ok).toBe(false);
    const row = await tampered.prepare("SELECT COUNT(*)::int AS n FROM licenses").first<{ n: number }>();
    expect(row!.n).toBe(0);
  });

  it("fails before touching the database when a source row is malformed", async () => {
    const bad: TableData = {
      ...ACTIVATION_DATA,
      licenses: [{ ...ACTIVATION_DATA.licenses![0]!, max_machines: "two" }],
    };
    await expect(transfer(db, ACTIVATION_TABLES, bad, { dryRun: false })).rejects.toThrow(/max_machines/);
    const row = await db.prepare("SELECT COUNT(*)::int AS n FROM licenses").first<{ n: number }>();
    expect(row!.n).toBe(0);
  });
});

describe("importing portal data", () => {
  it("loads users, accounts and sessions in foreign-key order; a missing dub_jobs table is fine", async () => {
    const { db } = await freshDb("portal");
    const data: TableData = {
      user: [
        {
          id: "u1",
          name: "Operator",
          email: "op@example.com",
          email_verified: 1,
          image: null,
          created_at: 1_785_000_000_000,
          updated_at: 1_785_000_100_000,
        },
      ],
      session: [
        {
          id: "s1",
          expires_at: 1_785_999_000_000,
          token: "tok",
          created_at: 1_785_000_000_000,
          updated_at: 1_785_000_000_000,
          ip_address: null,
          user_agent: "curl",
          user_id: "u1",
        },
      ],
      account: [
        {
          id: "a1",
          account_id: "u1",
          provider_id: "credential",
          user_id: "u1",
          access_token: null,
          refresh_token: null,
          id_token: null,
          access_token_expires_at: null,
          refresh_token_expires_at: null,
          scope: null,
          password: "scrypt-hash",
          created_at: 1_785_000_000_000,
          updated_at: 1_785_000_000_000,
        },
      ],
      verification: [],
    };

    const report = await transfer(db, PORTAL_TABLES, data, { dryRun: false });

    expect(report.ok).toBe(true);
    expect(report.committed).toBe(true);
    expect(report.tables.find((t) => t.table === "dub_jobs")).toMatchObject({ sourceRows: 0, targetRows: 0 });
    const user = await db
      .prepare('SELECT email_verified FROM "user" WHERE id = ?')
      .bind("u1")
      .first<{ email_verified: boolean }>();
    expect(user!.email_verified).toBe(true);
  });
});

describe("exporting from D1", () => {
  const source = D1_SOURCES.activation!;

  function fakeFetch(handler: (sql: string) => { results?: unknown[]; error?: string }): typeof fetch {
    return (async (_url: unknown, init?: RequestInit) => {
      const { sql } = JSON.parse(String(init!.body)) as { sql: string };
      const out = handler(sql);
      if (out.error) {
        return Response.json({ success: false, errors: [{ message: out.error }], result: [] }, { status: 400 });
      }
      return Response.json({ success: true, errors: [], result: [{ results: out.results ?? [], success: true }] });
    }) as typeof fetch;
  }

  it("issues only SELECT statements and lists columns explicitly", async () => {
    const seen: string[] = [];
    const data = await exportD1({
      accountId: "acct",
      apiToken: "token",
      source,
      fetchImpl: fakeFetch((sql) => {
        seen.push(sql);
        return { results: [] };
      }),
    });

    expect(Object.keys(data)).toEqual(["licenses", "activations"]);
    expect(seen.length).toBeGreaterThan(0);
    for (const sql of seen) {
      expect(sql).toMatch(/^SELECT "id", /);
      expect(sql).not.toMatch(/INSERT|UPDATE|DELETE|DROP|ALTER/i);
    }
  });

  it("pages through large tables", async () => {
    const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `r${i}` }));
    let licenseCalls = 0;
    const data = await exportD1({
      accountId: "acct",
      apiToken: "token",
      source,
      fetchImpl: fakeFetch((sql) => {
        if (!sql.includes('FROM "licenses"')) return { results: [] };
        licenseCalls += 1;
        return { results: licenseCalls === 1 ? rows(5000) : rows(3) };
      }),
    });

    expect(licenseCalls).toBe(2);
    expect(data.licenses).toHaveLength(5003);
  });

  it("skips a table that does not exist in an older source, but only the optional one", async () => {
    const portal = D1_SOURCES.portal!;
    const data = await exportD1({
      accountId: "acct",
      apiToken: "token",
      source: portal,
      fetchImpl: fakeFetch((sql) =>
        sql.includes('FROM "dub_jobs"') ? { error: "no such table: dub_jobs: SQLITE_ERROR" } : { results: [] },
      ),
    });
    expect(data).not.toHaveProperty("dub_jobs");
    expect(data).toHaveProperty("user");

    await expect(
      exportD1({
        accountId: "acct",
        apiToken: "token",
        source: portal,
        fetchImpl: fakeFetch((sql) =>
          sql.includes('FROM "user"') ? { error: "no such table: user" } : { results: [] },
        ),
      }),
    ).rejects.toThrow(/exporting user/);
  });

  it("surfaces API errors without echoing the token", async () => {
    const failure = exportD1({
      accountId: "acct",
      apiToken: "super-secret-token",
      source,
      fetchImpl: fakeFetch(() => ({ error: "Authentication error" })),
    });
    await expect(failure).rejects.toThrow("Authentication error");
    await failure.catch((err: Error) => expect(err.message).not.toContain("super-secret-token"));
  });
});
