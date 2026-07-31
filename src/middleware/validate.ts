import { createMiddleware } from "hono/factory";
import type { z } from "zod";
import { ApiError } from "@/lib/errors";
import type { AppEnv } from "@/types/env";

type Target = "json" | "query";

/**
 * Builds a `validate` bound to a specific `Env`. `target`'s type parameter
 * `K` is inferred from the literal passed at the call site, not widened to
 * the `Target` union — using `Target` directly in `Record<`valid_${Target}`,
 * ...>` would require BOTH `valid_json` and `valid_query` on every call's
 * `Variables`, which is wrong (a single call only ever sets one).
 *
 * `Env` is a curried type parameter rather than a defaulted trailing one:
 * TypeScript's explicit-generics instantiation is all-or-nothing left to
 * right, so a defaulted `Env` after `K`/`T` would force every non-default
 * caller to also spell out `K` and `T` just to reach `Env` — which defeats
 * inferring them from `target`/`schema`. Currying keeps both inferred.
 */
function makeValidate<Env extends { Bindings: object; Variables: object }>() {
  /**
   * Zod validation middleware. Parses the chosen request target and stashes
   * the typed result on `c.var[`valid_${target}`]`. On failure it throws a
   * 400 ApiError carrying flattened field errors — no raw Zod internals leak
   * out.
   *
   * Usage:
   *   app.post("/x", validate("json", BodySchema), (c) => {
   *     const body = c.get("valid_json"); // typed
   *   });
   */
  return function validate<K extends Target, T extends z.ZodTypeAny>(target: K, schema: T) {
    return createMiddleware<Env & { Variables: Env["Variables"] & Record<`valid_${K}`, z.infer<T>> }>(
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
  };
}

/** Validation middleware for the portal Worker's `AppEnv`. */
export const validate = makeValidate<AppEnv>();

/**
 * Validation middleware factory for other Workers in this repo whose `Env`
 * isn't `AppEnv` — e.g. the activation Worker's admin-only mint route. Call
 * as `validateFor<TheirEnv>()("json", schema)`.
 */
export const validateFor = makeValidate;
