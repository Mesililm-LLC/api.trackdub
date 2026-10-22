/**
 * One-time database bootstrap, run by an operator with the RDS admin
 * credentials before the first migration. Idempotent: safe to re-run (it
 * resets the application role passwords to the supplied values).
 *
 * Creates two login roles and two databases, each owned by its own role, and
 * limits CONNECT so each role can only reach its own database. The application
 * tasks only ever receive their own role's password, never the admin's.
 *
 *   BOOTSTRAP_ADMIN_URL=postgres://trackdub_admin:<pw>@<rds-endpoint>:5432/postgres?sslmode=require \
 *   BOOTSTRAP_API_PASSWORD=<ApiDbCredentials password> \
 *   BOOTSTRAP_ACTIVATION_PASSWORD=<ActivationDbCredentials password> \
 *   bun run server/bootstrap-db.ts
 *
 * The RDS instance is in an isolated subnet, so run this from a host that can
 * reach it (for example an SSM port-forward through a bastion, or a one-off
 * task in the VPC). See infra/README.md.
 */
import postgres from "postgres";
import { exit, processEnv } from "./process";

const ROLES = [
  { role: "trackdub_api_app", database: "trackdub_api", passwordVar: "BOOTSTRAP_API_PASSWORD" },
  {
    role: "trackdub_activation_app",
    database: "trackdub_activation",
    passwordVar: "BOOTSTRAP_ACTIVATION_PASSWORD",
  },
] as const;

const adminUrl = processEnv.BOOTSTRAP_ADMIN_URL;
if (!adminUrl) {
  console.error("BOOTSTRAP_ADMIN_URL is required");
  exit(1);
}

const passwords = new Map<string, string>();
for (const { passwordVar } of ROLES) {
  const value = processEnv[passwordVar];
  if (!value || value.length < 16) {
    console.error(`${passwordVar} is required (at least 16 characters)`);
    exit(1);
  }
  passwords.set(passwordVar, value);
}

const sql = postgres(adminUrl, { max: 1, onnotice: () => {} });

/** Run a statement built by PostgreSQL's own quoting (`format` with %I / %L). */
async function runFormatted(template: string, ...args: string[]): Promise<void> {
  const rows = await sql.unsafe(`SELECT format(${template}) AS stmt`, args);
  await sql.unsafe(rows[0]!.stmt as string);
}

try {
  for (const { role, database, passwordVar } of ROLES) {
    const password = passwords.get(passwordVar)!;

    const existingRole = await sql.unsafe("SELECT 1 FROM pg_roles WHERE rolname = $1", [role]);
    if (existingRole.length === 0) {
      await runFormatted(`'CREATE ROLE %I LOGIN PASSWORD %L', $1::text, $2::text`, role, password);
    } else {
      await runFormatted(`'ALTER ROLE %I PASSWORD %L', $1::text, $2::text`, role, password);
    }

    // The role must be a member of the admin role to be set as owner on RDS.
    await runFormatted(`'GRANT %I TO CURRENT_USER', $1::text`, role);

    const existingDb = await sql.unsafe("SELECT 1 FROM pg_database WHERE datname = $1", [database]);
    if (existingDb.length === 0) {
      await runFormatted(`'CREATE DATABASE %I OWNER %I', $1::text, $2::text`, database, role);
    } else {
      await runFormatted(`'ALTER DATABASE %I OWNER TO %I', $1::text, $2::text`, database, role);
    }

    await runFormatted(`'REVOKE CONNECT ON DATABASE %I FROM PUBLIC', $1::text`, database);
    await runFormatted(`'GRANT CONNECT ON DATABASE %I TO %I', $1::text, $2::text`, database, role);
    console.log(JSON.stringify({ level: "info", msg: "database ready", database, role }));
  }
} catch (err) {
  console.error(JSON.stringify({ level: "error", msg: "bootstrap failed", error: String(err) }));
  exit(1);
} finally {
  await sql.end({ timeout: 5 });
}
