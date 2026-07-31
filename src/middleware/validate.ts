import { createMiddleware } from "hono/factory";
import type { z } from "zod";
import { ApiError } from "@/lib/errors";
import type { AppEnv } from "@/types/env";

type Target = "json" | "query";

/**
 * Zod validation middleware. Parses the chosen request target and stashes the
 * typed result on `c.var[`valid_${target}`]`. On failure it throws a 400
 * ApiError carrying flattened field errors — no raw Zod internals leak out.
 *
 * Generic over `Env` (defaulting to the portal's `AppEnv`) so it's reusable by
 * other Workers in this repo — e.g. the activation Worker's admin-only mint
 * route — without duplicating this logic. The Zod/ApiError behavior itself has
 * no portal-specific assumptions.
 *
 * Usage:
 *   app.post("/x", validate("json", BodySchema), (c) => {
 *     const body = c.get("valid_json"); // typed
 *   });
 */
export function validate<T extends z.ZodTypeAny, Env extends { Bindings: object; Variables: object } = AppEnv>(
  target: Target,
  schema: T,
) {
  return createMiddleware<Env & { Variables: Env["Variables"] & Record<`valid_${Target}`, z.infer<T>> }>(
    async (c, next) => {
      const raw =
        target === "json"
          ? await c.req.json().catch(() => {
              throw ApiError.badRequest("Request body must be valid JSON");
            })
          : Object.fromEntries(new URL(c.req.url).searchParams);

      const parsed = schema.safeParse(raw);
      if (!parsed.success) {
        throw ApiError.badRequest("Validation failed", parsed.error.flatten());
      }
      c.set(`valid_${target}`, parsed.data);
      await next();
    },
  );
}
