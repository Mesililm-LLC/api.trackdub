import { Hono } from "hono";
import { cors } from "hono/cors";
import { createAuth } from "@/auth";
import { loadConfig } from "@/config/env";
import { requestId } from "@/middleware/request-id";
import { requestLogging } from "@/middleware/logging";
import { onError } from "@/middleware/error";
import { ApiError, toErrorBody } from "@/lib/errors";
import { health } from "@/routes/health";
import { version } from "@/routes/version";
import { languages } from "@/routes/languages";
import { admin } from "@/routes/admin";
import { dubs } from "@/routes/dubs";
import type { AppEnv } from "@/types/env";

const app = new Hono<AppEnv>({ strict: false });

// --- Cross-cutting middleware (order matters) ---
app.use("*", requestId);
app.use("*", requestLogging);

// CORS: only the portal origin + local dev, credentials enabled, never `*`.
// Origin is validated against the configured allowlist per request.
app.use("*", async (c, next) => {
  const { allowedOrigins } = loadConfig(c.env);
  return cors({
    origin: (origin) => (origin && allowedOrigins.includes(origin) ? origin : null),
    credentials: true,
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    maxAge: 86400,
  })(c, next);
});

// Contract alias: the portal calls `GET /api/auth/session`, but Better Auth
// serves this at `/api/auth/get-session`. Rather than change the frontend, we
// rewrite the path onto Better Auth's handler so response + cookie behavior are
// identical. See docs/CONTRACT-MISMATCHES.md.
app.get("/api/auth/session", (c) => {
  const auth = createAuth(c.env);
  const url = new URL(c.req.url);
  url.pathname = "/api/auth/get-session";
  return auth.handler(new Request(url, c.req.raw));
});

// --- Better Auth: owns everything else under /api/auth/* ---
// (sign-in/email, sign-out, get-session, forget-password, reset-password, ...)
app.on(["GET", "POST"], "/api/auth/*", (c) => {
  const auth = createAuth(c.env);
  return auth.handler(c.req.raw);
});

// --- Application routes ---
app.route("/api/health", health);
app.route("/api/version", version);
app.route("/api/languages", languages);
app.route("/api/admin", admin);
// Portal CreateJobPage posts to `/api/dubs/` (trailing slash); strict:false on
// the dubs sub-app accepts both `/api/dubs` and `/api/dubs/`.
app.route("/api/dubs", dubs);

// --- 404 + centralized error handling ---
app.notFound((c) =>
  c.json(toErrorBody(ApiError.notFound(), c.get("requestId") ?? "unknown"), 404),
);
app.onError(onError);

export default app;
