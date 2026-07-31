/**
 * Seat (machine-activation) accounting.
 *
 * Ported verbatim — SQL and control flow unchanged — from the archived
 * monorepo activation service (`services/activation-service/src/index.ts` in
 * Trackdub-Monorepo-Archive). That service was reviewed but never deployed;
 * the SQL here is nonetheless load-bearing concurrency correctness, not
 * incidental style, so it is not rewritten through an ORM. Each conditional
 * INSERT/UPDATE carries its seat-count predicate in the same statement as the
 * write, so two concurrent requests racing for the last seat cannot both
 * succeed — D1/SQLite serializes the write and only one predicate evaluates
 * true.
 */

export type LicenseRow = {
  id: string;
  tier: string;
  status: string;
  max_machines: number;
};

export async function getActiveMachineFingerprints(
  db: D1Database,
  licenseId: string,
): Promise<string[]> {
  const result = await db
    .prepare("SELECT fingerprint_hash FROM activations WHERE license_id = ? AND status = ?")
    .bind(licenseId, "active")
    .all<{ fingerprint_hash: string }>();

  return (result.results ?? []).map((a) => `sha256:${a.fingerprint_hash}`);
}

export type EnsureActivationResult = "existing" | "inserted" | "max_reached";

/**
 * Atomically register a fingerprint when seats remain. Reuses a released row
 * for the same fingerprint instead of hitting the UNIQUE constraint.
 */
export async function ensureActiveActivation(
  db: D1Database,
  license: LicenseRow,
  fingerprint: string,
  generateId: () => string,
): Promise<EnsureActivationResult> {
  const existingRow = await db
    .prepare("SELECT id, status FROM activations WHERE license_id = ? AND fingerprint_hash = ?")
    .bind(license.id, fingerprint)
    .first<{ id: string; status: string }>();

  if (existingRow?.status === "active") {
    return "existing";
  }

  const activatedAt = new Date().toISOString();

  if (existingRow?.status === "released") {
    const reviveResult = await db
      .prepare(
        `UPDATE activations
         SET status = 'active', activated_at = ?, released_at = NULL
         WHERE id = ?
           AND status = 'released'
           AND (SELECT COUNT(*) FROM activations WHERE license_id = ? AND status = 'active') < ?`,
      )
      .bind(activatedAt, existingRow.id, license.id, license.max_machines)
      .run();

    if ((reviveResult.meta.changes ?? 0) > 0) {
      return "inserted";
    }

    const racedActive = await db
      .prepare(
        "SELECT id FROM activations WHERE license_id = ? AND fingerprint_hash = ? AND status = ?",
      )
      .bind(license.id, fingerprint, "active")
      .first<{ id: string }>();

    return racedActive ? "existing" : "max_reached";
  }

  const activationId = generateId();
  const insertResult = await db
    .prepare(
      `INSERT INTO activations (id, license_id, fingerprint_hash, status, activated_at)
       SELECT ?, ?, ?, 'active', ?
       WHERE (SELECT COUNT(*) FROM activations WHERE license_id = ? AND status = 'active') < ?
         AND NOT EXISTS (
           SELECT 1 FROM activations WHERE license_id = ? AND fingerprint_hash = ?
         )`,
    )
    .bind(
      activationId,
      license.id,
      fingerprint,
      activatedAt,
      license.id,
      license.max_machines,
      license.id,
      fingerprint,
    )
    .run();

  if ((insertResult.meta.changes ?? 0) > 0) {
    return "inserted";
  }

  const racedActivation = await db
    .prepare("SELECT id FROM activations WHERE license_id = ? AND fingerprint_hash = ? AND status = ?")
    .bind(license.id, fingerprint, "active")
    .first<{ id: string }>();

  return racedActivation ? "existing" : "max_reached";
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
export async function releaseActivation(db: D1Database, activationId: string): Promise<boolean> {
  const releasedAt = new Date().toISOString();
  const releaseResult = await db
    .prepare("UPDATE activations SET status = ?, released_at = ? WHERE id = ? AND status = ?")
    .bind("released", releasedAt, activationId, "active")
    .run();
  return (releaseResult.meta.changes ?? 0) > 0;
}

/**
 * Replacement seat claim for /reactivate. Uses the same max_machines
 * predicate as ensureActiveActivation so a concurrent /activate that fills
 * the freed seat cannot leave activations above max_machines.
 */
export async function replaceActivationSeat(
  db: D1Database,
  license: LicenseRow,
  oldActivationId: string,
  newFingerprint: string,
  generateId: () => string,
): Promise<ReplaceSeatResult> {
  if (!(await releaseActivation(db, oldActivationId))) {
    return "old_gone";
  }

  const claim = await ensureActiveActivation(db, license, newFingerprint, generateId);
  if (claim === "max_reached") {
    // Concurrent /activate took the freed seat — restore the old fingerprint.
    // This restore must carry the same max_machines predicate as every other
    // seat claim in this file: without it, a second concurrent /activate that
    // filled the freed seat AFTER the release but BEFORE this restore runs
    // would leave max_machines + 1 active (e.g. max=2, {A,B} active,
    // reactivate A->D releases A leaving {B}, a concurrent activate for C
    // fills it to {B,C}, D's claim above correctly fails at cap — but an
    // unconditional restore of A here would still push it to {A,B,C}=3). If
    // the cap is still full when this runs, A stays released rather than
    // pushing the count over max_machines; the caller still gets
    // max_activations either way, since D never got a seat regardless.
    await db
      .prepare(
        `UPDATE activations
         SET status = 'active', activated_at = ?, released_at = NULL
         WHERE id = ?
           AND status = 'released'
           AND (SELECT COUNT(*) FROM activations WHERE license_id = ? AND status = 'active') < ?`,
      )
      .bind(new Date().toISOString(), oldActivationId, license.id, license.max_machines)
      .run();
    return "max_reached";
  }

  return "replaced";
}

/**
 * Dev-unlimited path: upsert without a max_machines check. Only reachable
 * when config validation has confirmed ALLOW_DEV_LICENSES is enabled outside
 * production — see src/activation/config.ts.
 */
export async function upsertActiveActivationUnlimited(
  db: D1Database,
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
      .prepare("UPDATE activations SET status = ?, activated_at = ?, released_at = NULL WHERE id = ?")
      .bind("active", activatedAt, existing.id)
      .run();
    return;
  }

  // Guarded with NOT EXISTS rather than a plain INSERT: without it, two
  // concurrent requests for the same never-before-seen fingerprint can both
  // observe no row above and both attempt the INSERT — the second hits the
  // UNIQUE(license_id, fingerprint_hash) constraint and throws, surfacing as
  // an unhandled 500. A no-op here just means a concurrent request already
  // created the active row this one wanted; there's no seat cap to enforce
  // on this dev-unlimited-only path, so nothing further to do either way.
  await db
    .prepare(
      `INSERT INTO activations (id, license_id, fingerprint_hash, status, activated_at)
       SELECT ?, ?, ?, 'active', ?
       WHERE NOT EXISTS (
         SELECT 1 FROM activations WHERE license_id = ? AND fingerprint_hash = ?
       )`,
    )
    .bind(generateId(), licenseId, fingerprint, activatedAt, licenseId, fingerprint)
    .run();
}
