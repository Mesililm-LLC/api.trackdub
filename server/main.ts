/**
 * Container entrypoint for AWS (ECS Fargate). Not used by the Cloudflare
 * Workers deployment, which keeps using `src/index.ts` / `src/activation/index.ts`
 * through wrangler.
 *
 * One image serves both apps; `SERVICE` picks which Hono app runs:
 *   SERVICE=api         -> src/index.ts            (portal API)
 *   SERVICE=activation  -> src/activation/index.ts (license activation)
 *
 * Bun serves the default export (`port` + `fetch`). Hono apps expect a Workers
 * style `env` as the second argument to `fetch`, so process env vars and the
 * platform bindings are merged into one object here.
 */
import api from "@/index";
import activation from "@/activation/index";
import { createPlatformBindings } from "./bindings";
import { processEnv } from "./process";

const SERVICES = { api, activation } as const;
type ServiceName = keyof typeof SERVICES;

function isServiceName(value: string): value is ServiceName {
  return value in SERVICES;
}

const requested = processEnv.SERVICE ?? "api";
if (!isServiceName(requested)) {
  throw new Error(`SERVICE must be one of: ${Object.keys(SERVICES).join(", ")} (got "${requested}")`);
}

const app = SERVICES[requested];
const port = Number(processEnv.PORT ?? 8080);
const env = { ...processEnv, ...createPlatformBindings(requested) };

export default {
  port,
  fetch(request: Request): Response | Promise<Response> {
    // Liveness for the ALB target group. Deliberately independent of the
    // database and object store so a dependency outage does not make ECS
    // cycle healthy tasks. Readiness of those dependencies is reported by
    // /api/health on the api service.
    if (new URL(request.url).pathname === "/healthz") {
      return new Response("ok", { status: 200 });
    }
    // The two Hono apps are typed against different Bindings, so the shared
    // env object is passed untyped.
    return (app as { fetch(req: Request, env: unknown): Response | Promise<Response> }).fetch(request, env);
  },
};
