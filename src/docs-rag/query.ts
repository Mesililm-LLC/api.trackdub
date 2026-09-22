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

/** Thrown when AI Search's upstream limiter (code 2003) rejects the call. */
export class RateLimitedError extends Error {
  constructor() {
    super("upstream rate limited");
    this.name = "RateLimitedError";
  }
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
  /** Per-request keyword mode override; instance default is "and". */
  keywordMatchMode?: "and" | "or";
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
  const retrieval: Record<string, unknown> = {};
  if (options.keywordMatchMode) retrieval.keyword_match_mode = options.keywordMatchMode;
  const body: Record<string, unknown> = {
    query,
    max_num_results: options.max_num_results,
    ...(options.filters || options.keywordMatchMode
      ? { ai_search_options: { retrieval: { ...retrieval, ...(options.filters ? { filters: options.filters } : {}) } } }
      : {}),
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
    // AI Search's own upstream limiter (code 2003) signals backpressure to
    // clients as 429 rather than 503 so MCP clients apply Retry-After.
    if (response.status === 429 || detail.includes('"code":2003')) {
      throw new RateLimitedError();
    }
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

export async function searchDocs(env: DocsRagBindings, request: SearchRequest, clientKey?: string) {
  const filters = filterForScope(request.scope);
  const strict = await aiSearchRest(env, request.query, {
    filters,
    max_num_results: request.limit,
  });
  if ((strict.chunks?.length ?? 0) > 0) {
    return { scope: request.scope, matchMode: "and" as const, hits: hits(strict) };
  }
  // Strict "and" keyword matching returned nothing: retry once with "or" so
  // multi-term queries with one rare term still surface candidates. Vector
  // hits are unaffected; only the keyword side loosens.
  const loose = await aiSearchRest(env, request.query, {
    filters,
    max_num_results: request.limit,
    keywordMatchMode: "or",
  });
  return { scope: request.scope, matchMode: "or-fallback" as const, hits: hits(loose) };
}

export async function askDocs(env: DocsRagBindings, request: SearchRequest, clientKey?: string) {
  // Scoped retrieval must go through REST for folder filters (the legacy
  // binding rejects them). Generation also goes through REST now: the
  // legacy `aiSearch` binding accepts neither `messages` nor query
  // rewriting, while the chat-completions endpoint supports both.
  const filters = filterForScope(request.scope);
  const retrieval = await aiSearchRest(env, request.query, {
    filters,
    max_num_results: request.limit,
  });
  const context = retrieval.chunks ?? [];

  const chatUrl =
    `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}` +
    `/ai-search/instances/${env.AI_SEARCH_INSTANCE}/chat/completions`;
  const chatResponse = await fetch(chatUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.AI_SEARCH_API_TOKEN}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: request.query },
      ],
      model: env.AI_SEARCH_MODEL,
      max_num_results: request.limit,
      ai_search_options: {
        query_rewrite: { enabled: true },
        ...(filters ? { retrieval: { filters } } : {}),
      },
    }),
  });
  if (!chatResponse.ok) {
    const detail = await chatResponse.text().catch(() => "");
    if (chatResponse.status === 429 || detail.includes('"code":2003')) {
      throw new RateLimitedError();
    }
    throw new Error(`AI Search chat ${chatResponse.status}: ${detail.slice(0, 300)}`);
  }
  const chat = (await chatResponse.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    search_query?: string;
  };
  const answerText = chat.choices?.[0]?.message?.content ?? "";
  // Return REST-retrieved (scope-enforced) chunks, not the chat endpoint's
  // own retrieval, so scope guarantees hold for ask as well.
  return {
    scope: request.scope,
    searchQuery: chat.search_query ?? request.query,
    answer: answerText,
    hits: hits({
      chunks: context,
    }),
  };
}
