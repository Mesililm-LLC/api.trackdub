import { Hono } from "hono";
import { LANGUAGES } from "@/lib/languages";
import type { AppEnv } from "@/types/env";

/**
 * GET /api/languages — public static language catalog.
 *
 * The portal normalizes several envelopes; we return `{ items: [{code,name}] }`,
 * its documented preferred shape. Public because dropdown population (e.g. a
 * sign-up/create-job form) shouldn't require a session first.
 */
export const languages = new Hono<AppEnv>();

languages.get("/", (c) => c.json({ items: LANGUAGES }));
