import { pgTable, text, integer, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";

/**
 * PostgreSQL schema for the activation service. Ported from the archived reference
 * implementation's `migrations/0001_schema.sql` (Trackdub-Monorepo-Archive,
 * services/activation-service) — same tables, expressed as Drizzle so
 * `drizzle-kit generate` produces the migration and stays consistent with the
 * rest of this repo's schema style.
 *
 * This is a SEPARATE database from the portal's (`src/db/schema.ts`) —
 * licenses/activations have no relation to portal users/sessions.
 */

export const licenses = pgTable("licenses", {
  id: text("id").primaryKey(),
  keyHash: text("key_hash").notNull().unique(),
  tier: text("tier").notNull().default("pro"),
  buyerEmail: text("buyer_email").notNull(),
  /** 'active' | 'revoked' */
  status: text("status").notNull().default("active"),
  maxMachines: integer("max_machines").notNull().default(2),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

export const activations = pgTable(
  "activations",
  {
    id: text("id").primaryKey(),
    licenseId: text("license_id")
      .notNull()
      .references(() => licenses.id),
    fingerprintHash: text("fingerprint_hash").notNull(),
    /** 'active' | 'released' */
    status: text("status").notNull().default("active"),
    activatedAt: timestamp("activated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    releasedAt: timestamp("released_at", { withTimezone: true, mode: "date" }),
  },
  (table) => [
    uniqueIndex("activations_license_fingerprint_unique").on(table.licenseId, table.fingerprintHash),
    // Seat accounting (ensureActiveActivation/replaceActivationSeat) and
    // /status both filter by (license_id, status) on every request — the
    // unique index above doesn't serve that, and without this a license with
    // many historical `released` rows degrades to a scan.
    index("activations_license_status_idx").on(table.licenseId, table.status),
  ],
);
