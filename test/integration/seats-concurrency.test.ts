/**
 * Seat accounting under real concurrency, against a real PostgreSQL server
 * through the production driver (postgres.js). The in-process PGlite used by
 * the rest of the suite has a single connection and cannot interleave
 * statements, so it cannot catch a race.
 *
 * Skipped unless TEST_DATABASE_URL points at a disposable PostgreSQL database
 * (CI provides one; locally: `TEST_DATABASE_URL=postgres://... bun run
 * test:integration`). Migrations are applied by the test.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ensureActiveActivation,
  getActiveMachineFingerprints,
  releaseActivation,
  replaceActivationSeat,
  upsertActiveActivationUnlimited,
  type LicenseRow,
} from "@/activation/lib/seats";
import type { SqlDatabase } from "@/platform/sql";
import { createPostgresSql } from "../../server/postgres";

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("seat accounting under concurrency (real PostgreSQL)", () => {
  let client: postgres.Sql;
  let db: SqlDatabase;

  beforeAll(async () => {
    client = postgres(url!, { max: 30, onnotice: () => {} });
    await migrate(drizzle(client), {
      migrationsFolder: path.resolve(import.meta.dirname, "../../migrations/activation"),
    });
    db = createPostgresSql(client);
  });

  afterAll(async () => {
    await client?.end({ timeout: 5 });
  });

  async function newLicense(maxMachines: number): Promise<LicenseRow> {
    const id = crypto.randomUUID();
    await db
      .prepare(
        "INSERT INTO licenses (id, key_hash, tier, buyer_email, status, max_machines) VALUES (?, ?, 'pro', 'it@example.com', 'active', ?)",
      )
      .bind(id, `hash-${id}`, maxMachines)
      .run();
    return { id, tier: "pro", status: "active", max_machines: maxMachines };
  }

  const fp = (n: number | string) => `fp-${n}-${crypto.randomUUID()}`;

  it("never grants more seats than max_machines when many requests race", async () => {
    for (let round = 0; round < 5; round++) {
      const license = await newLicense(3);
      const results = await Promise.all(
        Array.from({ length: 25 }, (_, i) =>
          ensureActiveActivation(db, license, fp(i), () => crypto.randomUUID()),
        ),
      );
      expect(results.filter((r) => r === "inserted")).toHaveLength(3);
      expect(results.filter((r) => r === "max_reached")).toHaveLength(22);
      expect(await getActiveMachineFingerprints(db, license.id)).toHaveLength(3);
    }
  });

  it("treats concurrent requests for the same fingerprint as one seat", async () => {
    const license = await newLicense(2);
    const same = fp("same");
    const results = await Promise.all(
      Array.from({ length: 10 }, () => ensureActiveActivation(db, license, same, () => crypto.randomUUID())),
    );
    expect(results.filter((r) => r === "inserted")).toHaveLength(1);
    expect(results.filter((r) => r === "existing")).toHaveLength(9);
    expect(await getActiveMachineFingerprints(db, license.id)).toHaveLength(1);
  });

  it("keeps a reactivate swap racing a fresh activation within max_machines", async () => {
    for (let round = 0; round < 10; round++) {
      const license = await newLicense(2);
      const a = fp("a");
      const b = fp("b");
      await ensureActiveActivation(db, license, a, () => crypto.randomUUID());
      await ensureActiveActivation(db, license, b, () => crypto.randomUUID());
      const row = await db
        .prepare("SELECT id FROM activations WHERE license_id = ? AND fingerprint_hash = ?")
        .bind(license.id, a)
        .first<{ id: string }>();

      await Promise.all([
        replaceActivationSeat(db, license, row!.id, fp("d"), () => crypto.randomUUID()),
        ensureActiveActivation(db, license, fp("c"), () => crypto.randomUUID()),
        ensureActiveActivation(db, license, fp("e"), () => crypto.randomUUID()),
      ]);

      const active = await getActiveMachineFingerprints(db, license.id);
      expect(active.length).toBeLessThanOrEqual(2);
    }
  });

  it("creates exactly one row when the unlimited upsert races on a new fingerprint", async () => {
    const license = await newLicense(1);
    const same = fp("dev");
    await Promise.all(
      Array.from({ length: 10 }, () =>
        upsertActiveActivationUnlimited(db, license.id, same, () => crypto.randomUUID()),
      ),
    );
    expect(await getActiveMachineFingerprints(db, license.id)).toHaveLength(1);
  });

  it("releases a seat exactly once under concurrent releases", async () => {
    const license = await newLicense(2);
    await ensureActiveActivation(db, license, fp("x"), () => crypto.randomUUID());
    const row = await db
      .prepare("SELECT id FROM activations WHERE license_id = ?")
      .bind(license.id)
      .first<{ id: string }>();
    const results = await Promise.all(Array.from({ length: 8 }, () => releaseActivation(db, row!.id)));
    expect(results.filter(Boolean)).toHaveLength(1);
  });
});
