import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

/**
 * Better Auth core schema (Drizzle / SQLite for D1) plus application tables.
 *
 * Auth column names follow Better Auth so the Drizzle adapter maps cleanly.
 * Timestamps are integer epoch-millis (`{ mode: "timestamp_ms" }`).
 */

export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" }).notNull().default(false),
  image: text("image"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const session = sqliteTable("session", {
  id: text("id").primaryKey(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  token: text("token").notNull().unique(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});

export const account = sqliteTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: integer("access_token_expires_at", { mode: "timestamp_ms" }),
  refreshTokenExpiresAt: integer("refresh_token_expires_at", { mode: "timestamp_ms" }),
  scope: text("scope"),
  password: text("password"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const verification = sqliteTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

/**
 * Portal cloud dub jobs. Status strings match portal `JobStatus`.
 * Processing is deferred: scaffold creates Queued rows; a later worker marks
 * Running/Completed and writes `output_media_path`. Do not fake completion.
 */
export const dubJobs = sqliteTable(
  "dub_jobs",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    projectName: text("project_name").notNull(),
    sourceLanguage: text("source_language").notNull(),
    targetLanguage: text("target_language").notNull(),
    status: text("status").notNull().default("Queued"),
    inputMediaPath: text("input_media_path").notNull(),
    outputMediaPath: text("output_media_path"),
    progressPercent: integer("progress_percent").notNull().default(0),
    currentStage: text("current_stage"),
    errorMessage: text("error_message"),
    durationSeconds: integer("duration_seconds"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
    completedAt: integer("completed_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    index("dub_jobs_user_id_idx").on(table.userId),
    index("dub_jobs_user_status_idx").on(table.userId, table.status),
    index("dub_jobs_user_created_idx").on(table.userId, table.createdAt),
  ],
);

export const schema = { user, session, account, verification, dubJobs };
