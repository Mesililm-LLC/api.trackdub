import { filterForScope, isDocScope, SYSTEM_PROMPT, type DocScope } from "@/docs-rag/scopes";
import type {
  DocsRagBindings,
  DocsRagSearchChunk,
  DocsRagSearchResult,
} from "@/docs-rag/types";

export interface SearchRequest {
  query: string;
  scope: DocScope;
  limit: number;
}

export function parseSearchBody(body: unknown): SearchRequest | { error: string } {
  if (!body || typeof body !== "object") return { error: "expected JSON object" };
  const record = body as Record<string, unknown>;
  const query = record.query;
  if (typeof query !== "string" || query.trim().length === 0) return { error: "query is required" };
  const scopeRaw = record.scope;
  const scope = typeof scopeRaw === "string" ? scopeRaw : "all";
  if (!isDocScope(scope)) return { error: `unknown scope: ${scope}` };
  const limitRaw = record.limit;
  const limit = typeof limitRaw === "number" && Number.isFinite(limitRaw) ? Math.trunc(limitRaw) : 8;
  if (limit < 1 || limit > 20) return { error: "limit must be 1..20" };
  return { query: query.trim(), scope, limit };
}

function chunkKey(chunk: DocsRagSearchChunk): string | null {
  return chunk.item?.key ?? null;
}

function hits(result: DocsRagSearchResult) {
  return (result.chunks ?? []).map((chunk) => ({
    score: chunk.score ?? null,
    key: chunkKey(chunk),
    text: (chunk.text ?? "").slice(0, 4000),
  }));
}

interface AiSearchRetrievalOptions {
  filters?: ReturnType<typeof filterForScope>;
  max_num_results: number;
}

/**
 * Call the AI Search REST search endpoint. The legacy `env.AI.autorag()`
 * binding does not accept the Vectorize-style filters this corpus needs
 * (folder range queries), so the Worker talks to the new REST API directly
 * using the instance's service token.
 */
async function aiSearchRest(
  env: DocsRagBindings,
  query: string,
  options: AiSearchRetrievalOptions,
): Promise<DocsRagSearchResult> {
  const token = env.AI_SEARCH_API_TOKEN;
  const body: Record<string, unknown> = {
    query,
    max_num_results: options.max_num_results,
    ...(options.filters ? { ai_search_options: { retrieval: { filters: options.filters } } } : {}),
  };
  const url =
    `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}` +
    `/ai-search/instances/${env.AI_SEARCH_INSTANCE}/search`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`AI Search REST ${response.status}: ${detail.slice(0, 300)}`);
  }
  const payload = (await response.json()) as { success?: boolean; result?: DocsRagSearchResult; errors?: unknown };
  if (!payload.success || !payload.result) {
    throw new Error(`AI Search REST error: ${JSON.stringify(payload.errors ?? payload).slice(0, 300)}`);
  }
  console.log(
    `[docs-rag] search instance=${env.AI_SEARCH_INSTANCE} query=${JSON.stringify(query).slice(0, 120)} filters=${JSON.stringify(options.filters ?? null)} chunks=${payload.result.chunks?.length ?? 0}`,
  );
  return payload.result;
}

export async function searchDocs(env: DocsRagBindings, request: SearchRequest) {
  const filters = filterForScope(request.scope);
  const result = await aiSearchRest(env, request.query, {
    filters,
    max_num_results: request.limit,
  });
  return { scope: request.scope, hits: hits(result) };
}

export async function askDocs(env: DocsRagBindings, request: SearchRequest) {
  // Generation via the legacy binding (aiSearch) is fine for model output,
  // but scoped retrieval must go through REST for folder filters. Fall back
  // to unscoped binding generation when the token lacks REST access is NOT
  // supported: scopes are enforced here, so a REST failure is a hard error.
  const filters = filterForScope(request.scope);
  const retrieval = await aiSearchRest(env, request.query, {
    filters,
    max_num_results: request.limit,
  });
  const context = retrieval.chunks ?? [];
  const answer = await env.AI.autorag(env.AI_SEARCH_INSTANCE).aiSearch({
    query: request.query,
    model: env.AI_SEARCH_MODEL,
    system_prompt: SYSTEM_PROMPT,
    max_num_results: request.limit,
    rewrite_query: true,
    ranking_options: { score_threshold: 0.4 },
    ...(filters ? { filters } : {}),
  });
  return {
    scope: request.scope,
    searchQuery: answer.search_query ?? request.query,
    answer: answer.response ?? "",
    hits: hits({
      chunks: context.map((chunk) => chunk),
    } as DocsRagSearchResult),
  };
}
