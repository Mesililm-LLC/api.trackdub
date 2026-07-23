import { Hono } from "hono";
import { LANGUAGES } from "@/lib/languages";
import { requireAuth } from "@/middleware/auth";
import type { AppEnv } from "@/types/env";

/**
 * GET /api/languages — authenticated static language catalog.
 *
 * The portal normalizes several envelopes; we return `{ items: [{code,name}] }`,
 * its documented preferred shape. Requiring a session here proves authenticated
 * API routing works end-to-end (the stated purpose of this endpoint in PR1).
 */
export const languages = new Hono<AppEnv>();

languages.get("/", requireAuth, (c) => c.json({ items: LANGUAGES }));
