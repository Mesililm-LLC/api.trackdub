/**
 * One-time Cloudflare D1 -> PostgreSQL data move.
 *
 *   export:  read a D1 database (read-only) into JSON files
 *     CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_API_TOKEN=... \
 *       bun run server/d1-migrate.ts export <source> <dir>
 *
 *   import:  load those files into the PostgreSQL database named by DATABASE_*
 *     DATABASE_HOST=... DATABASE_NAME=... DATABASE_USER=... DATABASE_PASSWORD=... \
 *       bun run server/d1-migrate.ts import <source> <dir> [--dry-run]
 *
 * <source> is one of: portal, activation, activation-staging.
 *
 * `import` refuses to run unless the target database is empty, verifies row
 * counts and content digests inside the transaction, and commits only when
 * everything matches. `--dry-run` does all of that and then rolls back, so it
 * is safe to rehearse against the real database.
 *
 * The exported files contain personal data and credential material (emails,
 * password hashes, license key hashes, session tokens). Keep them outside the
 * repository and delete them after the import.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createPostgresSql, connectFromEnv } from "./postgres";
import { exit, processEnv } from "./process";
import { exportD1 } from "./d1/export";
import { D1_SOURCES } from "./d1/tables";
import { transfer, type TableData } from "./d1/transfer";

const [command, sourceName, dir, ...flags] = process.argv.slice(2);

function usage(message: string): never {
  console.error(message);
  console.error("usage: d1-migrate.ts export|import <portal|activation|activation-staging> <dir> [--dry-run]");
  return exit(2);
}

if (command !== "export" && command !== "import") usage("unknown command");
const source = sourceName ? D1_SOURCES[sourceName] : undefined;
if (!source || !sourceName) usage("unknown source");
if (!dir) usage("missing <dir>");
const sourceDir = path.resolve(dir, sourceName);

if (command === "export") {
  const accountId = processEnv.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = processEnv.CLOUDFLARE_API_TOKEN;
  if (!accountId || !apiToken) usage("CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are required");

  const data = await exportD1({ accountId, apiToken, source });
  await mkdir(sourceDir, { recursive: true });
  const counts: Record<string, number> = {};
  for (const [table, rows] of Object.entries(data)) {
    await writeFile(path.join(sourceDir, `${table}.json`), JSON.stringify(rows));
    counts[table] = rows.length;
  }
  await writeFile(
    path.join(sourceDir, "manifest.json"),
    JSON.stringify({ source: sourceName, exportedAt: new Date().toISOString(), counts }, null, 2),
  );
  console.log(JSON.stringify({ level: "info", msg: "exported", source: sourceName, dir: sourceDir, counts }));
  exit(0);
}

// --- import ---
const expectedDatabase = source.target === "api" ? "trackdub_api" : "trackdub_activation";
if (processEnv.DATABASE_NAME !== expectedDatabase) {
  usage(`source "${sourceName}" belongs in database "${expectedDatabase}", but DATABASE_NAME is "${processEnv.DATABASE_NAME}"`);
}
const client = connectFromEnv({ ...processEnv, DATABASE_POOL_MAX: "1" });
if (!client) usage("DATABASE_HOST, DATABASE_NAME and DATABASE_USER must be set");

const manifest = JSON.parse(await readFile(path.join(sourceDir, "manifest.json"), "utf8")) as {
  exportedAt: string;
  counts: Record<string, number>;
};
const data: TableData = {};
for (const table of Object.keys(manifest.counts)) {
  data[table] = JSON.parse(await readFile(path.join(sourceDir, `${table}.json`), "utf8"));
}

const dryRun = flags.includes("--dry-run");
console.log(
  JSON.stringify({
    level: "info",
    msg: dryRun ? "dry run (will roll back)" : "importing",
    source: sourceName,
    exportedAt: manifest.exportedAt,
    host: processEnv.DATABASE_HOST,
    database: processEnv.DATABASE_NAME,
  }),
);

try {
  const report = await transfer(createPostgresSql(client), source.tables, data, { dryRun });
  for (const t of report.tables) {
    console.log(
      JSON.stringify({
        level: t.ok ? "info" : "error",
        table: t.table,
        sourceRows: t.sourceRows,
        targetRows: t.targetRows,
        match: t.ok,
      }),
    );
  }
  console.log(
    JSON.stringify({ level: report.ok ? "info" : "error", msg: report.committed ? "committed" : "not committed", ok: report.ok }),
  );
  if (!report.ok) exit(1);
} catch (err) {
  console.error(JSON.stringify({ level: "error", msg: "import failed", error: String(err) }));
  exit(1);
} finally {
  await client.end({ timeout: 5 });
}
