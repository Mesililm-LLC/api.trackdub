import { beforeAll } from "vitest";
import { migrate } from "../support/portal-env";

// Better Auth's better-call double-surfaces APIError rejections from sign-in
// routes: the error is already caught and turned into a 401 response, but a
// second copy leaks as an unhandled rejection. Swallow only those specific
// errors so any other unhandled rejection still fails the run.
process.on("unhandledRejection", (reason: unknown) => {
  const code = (reason as { body?: { code?: string } } | null)?.body?.code;
  if (code !== "INVALID_EMAIL_OR_PASSWORD") throw reason;
});

/** Apply the portal migrations to this file's in-process PostgreSQL once. */
beforeAll(async () => {
  await migrate();
});
