import { pgTable, text, integer, boolean, timestamp, index } from "drizzle-orm/pg-core";

/**
 * Better Auth core schema (Drizzle / PostgreSQL) plus application tables.
 *
 * Auth column names follow Better Auth so the Drizzle adapter maps cleanly.
 * Timestamps are `timestamptz`, surfaced to the app as `Date`.
 */

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: ts("created_at").notNull(),
  updatedAt: ts("updated_at").notNull(),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: ts("expires_at").notNull(),
  token: text("token").notNull().unique(),
  createdAt: ts("created_at").notNull(),
  updatedAt: ts("updated_at").notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: ts("access_token_expires_at"),
  refreshTokenExpiresAt: ts("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: ts("created_at").notNull(),
  updatedAt: ts("updated_at").notNull(),
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: ts("expires_at").notNull(),
  createdAt: ts("created_at").notNull(),
  updatedAt: ts("updated_at").notNull(),
});

/**
 * Portal cloud dub jobs. Status strings match portal `JobStatus`.
 * Processing is deferred: scaffold creates Queued rows; a later worker marks
 * Running/Completed and writes `output_media_path`. Do not fake completion.
 */
export const dubJobs = pgTable(
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
    createdAt: ts("created_at").notNull(),
    updatedAt: ts("updated_at").notNull(),
    completedAt: ts("completed_at"),
  },
  (table) => [
    index("dub_jobs_user_id_idx").on(table.userId),
    index("dub_jobs_user_status_idx").on(table.userId, table.status),
    index("dub_jobs_user_created_idx").on(table.userId, table.createdAt),
  ],
);

export const schema = { user, session, account, verification, dubJobs };
