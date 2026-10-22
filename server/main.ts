/**
 * Container entrypoint for AWS (ECS Fargate): serves the portal API (`src/index.ts`).
 *
 * License activation (`src/activation`) and docs-rag (`src/docs-rag`) are not
 * part of this container; they stay Cloudflare Workers.
 *
 * Bun serves the default export (`port` + `fetch`). The Hono app expects a
 * Workers style `env` as the second argument to `fetch`, so process env vars
 * and the platform bindings are merged into one object here.
 */
import api from "@/index";
import { createPlatformBindings } from "./bindings";
import { processEnv } from "./process";

const port = Number(processEnv.PORT ?? 8080);
const env = { ...processEnv, ...createPlatformBindings() };

export default {
  port,
  fetch(request: Request): Response | Promise<Response> {
    // Liveness for the ALB target group. Deliberately independent of the
    // database and object store so a dependency outage does not make ECS
    // cycle healthy tasks. Readiness of those dependencies is reported by
    // /api/health/ready.
    if (new URL(request.url).pathname === "/healthz") {
      return new Response("ok", { status: 200 });
    }
    return (api as { fetch(req: Request, env: unknown): Response | Promise<Response> }).fetch(request, env);
  },
};
