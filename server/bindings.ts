/**
 * Platform bindings for the container runtime.
 *
 * The route and auth code receive a Workers-style `env`. On AWS the `DB` and
 * `MEDIA` entries are built here from the task environment:
 *
 *   DB    PostgreSQL (postgres.js + Drizzle)   DATABASE_*
 *   MEDIA S3 bucket                            MEDIA_BUCKET, AWS_REGION
 *
 * Connections are lazy, so a task starts and passes `/healthz` even when the
 * database is down. When the database or bucket is not configured at all (for
 * example `docker run` without a database), the binding is left out and the
 * app reports the same "binding not bound" configuration error as before.
 */
import { connectFromEnv, createPostgresDatabase } from "./postgres";
import { createS3ObjectStore } from "./s3";
import { processEnv } from "./process";

export function createPlatformBindings(): Record<string, unknown> {
  const bindings: Record<string, unknown> = {};
  const missing: string[] = [];

  const client = connectFromEnv(processEnv);
  if (client) {
    bindings.DB = createPostgresDatabase(client);
  } else {
    missing.push("DB (DATABASE_HOST / DATABASE_NAME / DATABASE_USER)");
  }

  const bucket = processEnv.MEDIA_BUCKET;
  if (bucket) {
    bindings.MEDIA = createS3ObjectStore(bucket, processEnv.AWS_REGION);
  } else {
    missing.push("MEDIA (MEDIA_BUCKET)");
  }

  if (missing.length > 0) {
    console.warn(JSON.stringify({ level: "warn", msg: "platform bindings not configured", missing }));
  }
  return bindings;
}
