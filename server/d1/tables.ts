/**
 * Table definitions for the one-time Cloudflare D1 -> PostgreSQL data move.
 *
 * Each column names its SQLite representation so the importer can convert it
 * to the PostgreSQL type the new schema uses. Column names are identical on
 * both sides; only the storage types differ:
 *
 *   epochMs  INTEGER epoch milliseconds (portal)         -> timestamptz
 *   isoText  TEXT ISO-8601 or SQLite `datetime('now')`   -> timestamptz
 *   bool     INTEGER 0/1                                 -> boolean
 *
 * Tables are listed parent-first so foreign keys hold while inserting.
 */

export type ColumnKind = "text" | "int" | "bool" | "epochMs" | "isoText";

export interface ColumnSpec {
  name: string;
  kind: ColumnKind;
  nullable?: boolean;
}

export interface TableSpec {
  table: string;
  columns: ColumnSpec[];
  /** Stable ordering for export and for the verification checksum. */
  orderBy: string;
}

const text = (name: string, nullable = false): ColumnSpec => ({ name, kind: "text", nullable });
const int = (name: string, nullable = false): ColumnSpec => ({ name, kind: "int", nullable });
const bool = (name: string): ColumnSpec => ({ name, kind: "bool" });
const epochMs = (name: string, nullable = false): ColumnSpec => ({ name, kind: "epochMs", nullable });
const isoText = (name: string, nullable = false): ColumnSpec => ({ name, kind: "isoText", nullable });

export const PORTAL_TABLES: TableSpec[] = [
  {
    table: "user",
    orderBy: "id",
    columns: [
      text("id"),
      text("name"),
      text("email"),
      bool("email_verified"),
      text("image", true),
      epochMs("created_at"),
      epochMs("updated_at"),
    ],
  },
  {
    table: "session",
    orderBy: "id",
    columns: [
      text("id"),
      epochMs("expires_at"),
      text("token"),
      epochMs("created_at"),
      epochMs("updated_at"),
      text("ip_address", true),
      text("user_agent", true),
      text("user_id"),
    ],
  },
  {
    table: "account",
    orderBy: "id",
    columns: [
      text("id"),
      text("account_id"),
      text("provider_id"),
      text("user_id"),
      text("access_token", true),
      text("refresh_token", true),
      text("id_token", true),
      epochMs("access_token_expires_at", true),
      epochMs("refresh_token_expires_at", true),
      text("scope", true),
      text("password", true),
      epochMs("created_at"),
      epochMs("updated_at"),
    ],
  },
  {
    table: "verification",
    orderBy: "id",
    columns: [
      text("id"),
      text("identifier"),
      text("value"),
      epochMs("expires_at"),
      epochMs("created_at"),
      epochMs("updated_at"),
    ],
  },
  {
    // Present only once D1 migration 0001 has been applied. The exporter skips
    // a table that does not exist in the source (see EXPORT_OPTIONAL_TABLES).
    table: "dub_jobs",
    orderBy: "id",
    columns: [
      text("id"),
      text("user_id"),
      text("project_name"),
      text("source_language"),
      text("target_language"),
      text("status"),
      text("input_media_path"),
      text("output_media_path", true),
      int("progress_percent"),
      text("current_stage", true),
      text("error_message", true),
      int("duration_seconds", true),
      epochMs("created_at"),
      epochMs("updated_at"),
      epochMs("completed_at", true),
    ],
  },
];

export const ACTIVATION_TABLES: TableSpec[] = [
  {
    table: "licenses",
    orderBy: "id",
    columns: [
      text("id"),
      text("key_hash"),
      text("tier"),
      text("buyer_email"),
      text("status"),
      int("max_machines"),
      isoText("created_at"),
    ],
  },
  {
    table: "activations",
    orderBy: "id",
    columns: [
      text("id"),
      text("license_id"),
      text("fingerprint_hash"),
      text("status"),
      isoText("activated_at"),
      isoText("released_at", true),
    ],
  },
];

/** Tables that may legitimately be missing from an older source database. */
export const EXPORT_OPTIONAL_TABLES = new Set(["dub_jobs"]);

export interface D1Source {
  /** Cloudflare D1 database id (public identifier, from the wrangler configs). */
  databaseId: string;
  tables: TableSpec[];
  /** PostgreSQL database the data belongs in. */
  target: "api" | "activation";
}

export const D1_SOURCES: Record<string, D1Source> = {
  portal: { databaseId: "073c0238-db61-40d3-b1ee-3e7555493a72", tables: PORTAL_TABLES, target: "api" },
  activation: {
    databaseId: "f95337b1-aff5-455d-a0f9-3293211b1727",
    tables: ACTIVATION_TABLES,
    target: "activation",
  },
  "activation-staging": {
    databaseId: "d694b5d9-3c04-4534-a9cd-6892967fb5ee",
    tables: ACTIVATION_TABLES,
    target: "activation",
  },
};
