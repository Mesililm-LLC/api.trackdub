/**
 * Seat (machine-activation) accounting.
 *
 * Adapted from the archived monorepo activation service
 * (`services/activation-service/src/index.ts` in Trackdub-Monorepo-Archive).
 * The SQL is load-bearing concurrency correctness, not incidental style, so it
 * is not rewritten through an ORM.
 *
 * Concurrency model (PostgreSQL). The original ran on SQLite, where writes are
 * globally serialized, so a seat-count predicate inside a single INSERT/UPDATE
 * was enough: two requests racing for the last seat could not both succeed.
 * PostgreSQL does not serialize writers that way: under READ COMMITTED, two
 * concurrent `INSERT ... WHERE (SELECT COUNT(*) ...) < max` statements can both
 * observe the same count and both insert. Every seat change for a license
 * therefore runs in a transaction that first takes a row lock on the license
 * (`SELECT ... FOR UPDATE`), which serializes all activations for that license.
 * The count predicates stay in the statements as a second line of defense.
 */

import type { SqlDatabase } from "@/platform/sql";

export type LicenseRow = {
  id: string;
  tier: string;
  status: string;
  max_machines: number;
};

/** Serialize seat changes for one license until the surrounding transaction ends. */
async function lockLicense(tx: SqlDatabase, licenseId: string): Promise<void> {
  await tx.prepare("SELECT id FROM licenses WHERE id = ? FOR UPDATE").bind(licenseId).first();
}

export async function getActiveMachineFingerprints(
  db: SqlDatabase,
  licenseId: string,
): Promise<string[]> {
  const result = await db
    .prepare("SELECT fingerprint_hash FROM activations WHERE license_id = ? AND status = ?")
    .bind(licenseId, "active")
    .all<{ fingerprint_hash: string }>();

  return result.results.map((a) => `sha256:${a.fingerprint_hash}`);
}

export type EnsureActivationResult = "existing" | "inserted" | "max_reached";

/**
 * Register a fingerprint when seats remain. Reuses a released row for the same
 * fingerprint instead of hitting the UNIQUE constraint. Caller must hold the
 * license lock (see {@link ensureActiveActivation}).
 */
async function claimSeat(
  tx: SqlDatabase,
  license: LicenseRow,
  fingerprint: string,
  generateId: () => string,
): Promise<EnsureActivationResult> {
  const existingRow = await tx
    .prepare("SELECT id, status FROM activations WHERE license_id = ? AND fingerprint_hash = ?")
    .bind(license.id, fingerprint)
    .first<{ id: string; status: string }>();

  if (existingRow?.status === "active") {
    return "existing";
  }

  const activatedAt = new Date().toISOString();

  if (existingRow?.status === "released") {
    const reviveResult = await tx
      .prepare(
        `UPDATE activations
         SET status = 'active', activated_at = ?::timestamptz, released_at = NULL
         WHERE id = ?
           AND status = 'released'
           AND (SELECT COUNT(*) FROM activations WHERE license_id = ? AND status = 'active') < ?::int`,
      )
      .bind(activatedAt, existingRow.id, license.id, license.max_machines)
      .run();

    return reviveResult.meta.changes > 0 ? "inserted" : "max_reached";
  }

  const insertResult = await tx
    .prepare(
      `INSERT INTO activations (id, license_id, fingerprint_hash, status, activated_at)
       SELECT ?::text, ?::text, ?::text, 'active', ?::timestamptz
       WHERE (SELECT COUNT(*) FROM activations WHERE license_id = ? AND status = 'active') < ?::int
         AND NOT EXISTS (
           SELECT 1 FROM activations WHERE license_id = ? AND fingerprint_hash = ?
         )`,
    )
    .bind(
      generateId(),
      license.id,
      fingerprint,
      activatedAt,
      license.id,
      license.max_machines,
      license.id,
      fingerprint,
    )
    .run();

  return insertResult.meta.changes > 0 ? "inserted" : "max_reached";
}

/**
 * Atomically register a fingerprint when seats remain. Serialized per license,
 * so two requests racing for the last seat cannot both succeed.
 */
export async function ensureActiveActivation(
  db: SqlDatabase,
  license: LicenseRow,
  fingerprint: string,
  generateId: () => string,
): Promise<EnsureActivationResult> {
  return db.transaction(async (tx) => {
    await lockLicense(tx, license.id);
    return claimSeat(tx, license, fingerprint, generateId);
  });
}

export type ReplaceSeatResult = "replaced" | "old_gone" | "max_reached";

/**
 * Release an active activation by id. Returns whether it was actually
 * released (false if it was already released/gone — the caller decides what
 * that means). Shared by the capped /reactivate path below and the
 * dev-unlimited /reactivate path in routes/reactivate.ts, which must NOT
 * route through {@link ensureActiveActivation}'s max_machines check the way
 * {@link replaceActivationSeat} does.
 */
export async function releaseActivation(db: SqlDatabase, activationId: string): Promise<boolean> {
  const releasedAt = new Date().toISOString();
  const releaseResult = await db
    .prepare("UPDATE activations SET status = ?, released_at = ?::timestamptz WHERE id = ? AND status = ?")
    .bind("released", releasedAt, activationId, "active")
    .run();
  return releaseResult.meta.changes > 0;
}

/**
 * Replacement seat claim for /reactivate. Release and claim happen in one
 * transaction under the license lock, so a concurrent /activate cannot take the
 * freed seat between the two steps and leave activations above max_machines.
 */
export async function replaceActivationSeat(
  db: SqlDatabase,
  license: LicenseRow,
  oldActivationId: string,
  newFingerprint: string,
  generateId: () => string,
): Promise<ReplaceSeatResult> {
  return db.transaction(async (tx) => {
    await lockLicense(tx, license.id);

    if (!(await releaseActivation(tx, oldActivationId))) {
      return "old_gone";
    }

    const claim = await claimSeat(tx, license, newFingerprint, generateId);
    if (claim === "max_reached") {
      // The cap is full even after freeing the old seat. Put the old
      // fingerprint back (same max_machines predicate as every other claim)
      // so the caller's failed swap leaves the license as it found it.
      await tx
        .prepare(
          `UPDATE activations
           SET status = 'active', activated_at = ?::timestamptz, released_at = NULL
           WHERE id = ?
             AND status = 'released'
             AND (SELECT COUNT(*) FROM activations WHERE license_id = ? AND status = 'active') < ?::int`,
        )
        .bind(new Date().toISOString(), oldActivationId, license.id, license.max_machines)
        .run();
      return "max_reached";
    }

    return "replaced";
  });
}

/**
 * Dev-unlimited path: upsert without a max_machines check. Only reachable
 * when config validation has confirmed ALLOW_DEV_LICENSES is enabled outside
 * production — see src/activation/config.ts.
 */
export async function upsertActiveActivationUnlimited(
  db: SqlDatabase,
  licenseId: string,
  fingerprint: string,
  generateId: () => string,
): Promise<void> {
  const existing = await db
    .prepare("SELECT id, status FROM activations WHERE license_id = ? AND fingerprint_hash = ?")
    .bind(licenseId, fingerprint)
    .first<{ id: string; status: string }>();

  const activatedAt = new Date().toISOString();

  if (existing?.status === "active") {
    return;
  }

  if (existing?.status === "released") {
    await db
      .prepare(
        "UPDATE activations SET status = ?, activated_at = ?::timestamptz, released_at = NULL WHERE id = ?",
      )
      .bind("active", activatedAt, existing.id)
      .run();
    return;
  }

  // ON CONFLICT DO NOTHING rather than a plain INSERT: two concurrent requests
  // for the same never-before-seen fingerprint can both observe no row above
  // and both attempt the INSERT. The loser would otherwise hit the
  // UNIQUE(license_id, fingerprint_hash) constraint and surface as a 500. A
  // no-op just means a concurrent request already created the active row this
  // one wanted; there is no seat cap to enforce on this dev-unlimited path.
  await db
    .prepare(
      `INSERT INTO activations (id, license_id, fingerprint_hash, status, activated_at)
       VALUES (?, ?, ?, 'active', ?::timestamptz)
       ON CONFLICT (license_id, fingerprint_hash) DO NOTHING`,
    )
    .bind(generateId(), licenseId, fingerprint, activatedAt)
    .run();
}
