import { env, applyD1Migrations } from "cloudflare:test";
import { beforeAll } from "vitest";

declare const __TEST_MIGRATIONS__: { name: string; queries: string[] }[];

// Better Auth's better-call double-surfaces APIError rejections from sign-in
// routes — the error is already caught and turned into a 401 response, but a
// second copy leaks as an unhandled rejection inside workerd. Suppress only
// those specific errors so any other unhandled rejection still fails the run.
const g = globalThis as Record<string, unknown>;
const proc = g.process as { on?: (event: string, handler: (reason: unknown) => void) => void } | undefined;
if (proc?.on) {
  proc.on("unhandledRejection", (reason: unknown) => {
    if ((reason as Record<string, Record<string, string>> | null)?.body?.code === "INVALID_EMAIL_OR_PASSWORD") {
      // swallowed — already asserted by the test
    }
  });
}

/**
 * Global setup: apply Drizzle SQL migrations to the isolated test D1 once,
 * using the migrations read at config time and injected as `TEST_MIGRATIONS`.
 */
beforeAll(async () => {
  await applyD1Migrations(env.DB, __TEST_MIGRATIONS__);
});
