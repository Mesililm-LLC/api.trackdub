import { Hono } from "hono";
import { requireToken } from "@/docs-rag/auth";
import { handleMcp } from "@/docs-rag/mcp";
import { askDocs, parseSearchBody, searchDocs } from "@/docs-rag/query";
import { DOC_SCOPES } from "@/docs-rag/scopes";
import type { DocsRagEnv } from "@/docs-rag/types";

const app = new Hono<DocsRagEnv>();

app.get("/health", (c) =>
  c.json({
    ok: true,
    instance: c.env.AI_SEARCH_INSTANCE,
    model: c.env.AI_SEARCH_MODEL,
    scopes: DOC_SCOPES,
  }),
);

app.post("/mcp", async (c) => {
  const denied = requireToken(c.req.raw, c.env);
  if (denied) return denied;
  return handleMcp(c.req.raw, c.env);
});

app.post("/v1/search", async (c) => {
  const denied = requireToken(c.req.raw, c.env);
  if (denied) return denied;
  const parsed = parseSearchBody(await c.req.json().catch(() => null));
  if ("error" in parsed) return c.json({ error: parsed.error }, 400);
  try {
    return c.json(await searchDocs(c.env, parsed));
  } catch (error) {
    const message = error instanceof Error ? error.message : "search failed";
    return c.json({ error: "search_failed", message }, 503);
  }
});

app.post("/v1/ask", async (c) => {
  const denied = requireToken(c.req.raw, c.env);
  if (denied) return denied;
  const parsed = parseSearchBody(await c.req.json().catch(() => null));
  if ("error" in parsed) return c.json({ error: parsed.error }, 400);
  try {
    return c.json(await askDocs(c.env, parsed));
  } catch (error) {
    const message = error instanceof Error ? error.message : "ask failed";
    return c.json({ error: "ask_failed", message }, 503);
  }
});

app.notFound((c) => c.json({ error: "not_found" }, 404));

export default app;
