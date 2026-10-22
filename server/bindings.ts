/**
 * Platform bindings for the container runtime.
 *
 * On Cloudflare the app receives `DB` (D1) and `MEDIA` (R2) as bindings. On AWS
 * the equivalents are a PostgreSQL database (RDS) and an S3 bucket. The route
 * and auth code currently talk to the D1 and R2 interfaces directly, so those
 * adapters are the remaining port work tracked in docs/plans/aws-migration.md:
 *
 *   - DB:    Drizzle moves from `drizzle-orm/d1` to `drizzle-orm/postgres-js`,
 *            and the raw `prepare(...)` SQL in src/activation/** is ported.
 *   - MEDIA: an S3-backed object with the put / head / get surface used by
 *            src/routes/dubs.ts.
 *
 * Until then this returns no bindings. The container still boots and answers
 * `/healthz`, and every other route fails with the same "binding not bound"
 * configuration error the app reports today, instead of failing silently.
 */
import { processEnv } from "./process";

export type ServiceName = "api" | "activation";

export function createPlatformBindings(service: ServiceName): Record<string, unknown> {
  console.warn(
    JSON.stringify({
      level: "warn",
      msg: "platform bindings not implemented: DB and MEDIA are unbound",
      service,
      databaseHost: processEnv.DATABASE_HOST ?? null,
      mediaBucket: processEnv.MEDIA_BUCKET ?? null,
    }),
  );
  return {};
}
