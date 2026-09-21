import { afterEach, describe, expect, it, vi } from "vitest";
import { bearerAuthorized, checkRateLimits, limiterKeyFromToken } from "@/docs-rag/auth";
import { askDocs, parseSearchBody, RateLimitedError, searchDocs } from "@/docs-rag/query";
import { filterForScope, SYSTEM_PROMPT } from "@/docs-rag/scopes";
import type { DocsRagBindings } from "@/docs-rag/types";

function stubLimiter(success: boolean, calls: string[] = []): any {
  return {
    limit: async (opts: { key: string }) => {
      calls.push(opts.key);
      return { success };
    },
  };
}

describe("docs-rag scopes", () => {
  it("leaves all unfiltered", () => {
    expect(filterForScope("all")).toBeUndefined();
  });

  it("builds ASCII range filters for first-party and vendor folders", () => {
    expect(filterForScope("trackdub")).toEqual({
      folder: { $gte: "first-party/trackdub/", $lt: "first-party/trackdub0" },
    });
    expect(filterForScope("nvidia")).toEqual({
      folder: { $gte: "vendor/nvidia/", $lt: "vendor/nvidia0" },
    });
  });
});

describe("docs-rag request parsing", () => {
  it("rejects an empty query", () => {
    expect(parseSearchBody({ query: "  " })).toEqual({ error: "query is required" });
  });

  it("defaults scope and limit", () => {
    expect(parseSearchBody({ query: "TRT RTX plugin" })).toEqual({
      query: "TRT RTX plugin",
      scope: "all",
      limit: 8,
    });
  });

  it("rejects unknown scopes", () => {
    expect(parseSearchBody({ query: "x", scope: "cuda" })).toEqual({ error: "unknown scope: cuda" });
  });
});

describe("docs-rag auth", () => {
  it("rejects a short configured token", () => {
    expect(bearerAuthorized("Bearer short-token", "short-token")).toBe(false);
  });

  it("accepts a matching bearer token", () => {
    const token = "docs-rag-token-16";
    expect(bearerAuthorized(`Bearer ${token}`, token)).toBe(true);
    expect(bearerAuthorized("Bearer other-token-16ch", token)).toBe(false);
  });

  it("derives a stable limiter key without exposing the raw token", () => {
    const key1 = limiterKeyFromToken("aaaaaaaaaaaaaaaaaaaa");
    const key2 = limiterKeyFromToken("aaaaaaaaaaaaaaaaaaaa");
    const other = limiterKeyFromToken("bbbbbbbbbbbbbbbbbbbb");
    expect(key1).toBe(key2);
    expect(key1).not.toBe(other);
    expect(key1).not.toContain("aaaaaaaaaaaaaaaaaaaa");
  });
});

describe("docs-rag rate limits", () => {
  it("passes when all limiters succeed", async () => {
    const result = await checkRateLimits(
      { burst: stubLimiter(true), steady: stubLimiter(true) },
      "client",
    );
    expect(result.ok).toBe(true);
  });

  it("returns burst retry window on burst failure", async () => {
    const result = await checkRateLimits(
      { burst: stubLimiter(false), steady: stubLimiter(true) },
      "client",
    );
    expect(result.ok).toBe(false);
    expect(result.binding).toBe("burst");
    expect(result.retryAfterSeconds).toBe(10);
  });

  it("returns steady retry window on steady failure", async () => {
    const burstCalls: string[] = [];
    const result = await checkRateLimits(
      { burst: stubLimiter(true, burstCalls), steady: stubLimiter(false) },
      "client",
    );
    expect(result.ok).toBe(false);
    expect(result.binding).toBe("steady");
    expect(result.retryAfterSeconds).toBe(60);
    expect(burstCalls[0]).toBe("burst:client");
  });

  it("enforces the ask limiter only for expensive routes", async () => {
    const askCalls: string[] = [];
    const cheap = await checkRateLimits(
      { burst: stubLimiter(true), steady: stubLimiter(true) },
      "client",
    );
    expect(cheap.ok).toBe(true);

    const expensiveOk = await checkRateLimits(
      { burst: stubLimiter(true), steady: stubLimiter(true), ask: stubLimiter(true, askCalls) },
      "client",
      { expensive: true },
    );
    expect(expensiveOk.ok).toBe(true);
    expect(askCalls[0]).toBe("ask:client");

    const expensiveBlocked = await checkRateLimits(
      { burst: stubLimiter(true), steady: stubLimiter(true), ask: stubLimiter(false) },
      "client",
      { expensive: true },
    );
    expect(expensiveBlocked.ok).toBe(false);
    expect(expensiveBlocked.binding).toBe("ask");
    expect(expensiveBlocked.retryAfterSeconds).toBe(10);
  });
});

// Only fetch is stubbed: request construction, response validation and hit mapping stay real.
const queryEnv = {
  CF_ACCOUNT_ID: "test-account",
  AI_SEARCH_INSTANCE: "test-instance",
  AI_SEARCH_API_TOKEN: "test-service-token",
  AI_SEARCH_MODEL: "test-configured-model",
} as DocsRagBindings;
const apiUrl = "https://api.cloudflare.com/client/v4/accounts/test-account/ai-search/instances/test-instance";
const sourceChunk = {
  id: "chunk-1",
  type: "text",
  score: 0.87,
  text: "Use the standalone EP plugin.",
  item: { key: "vendor/nvidia/plugin.md", timestamp: 1, metadata: {} },
};
const sourceHit = { score: 0.87, key: "vendor/nvidia/plugin.md", text: "Use the standalone EP plugin." };
const scopedRequest = { query: "TRT RTX plugin", scope: "nvidia", limit: 3 } as const;

function searchResponse(chunks: unknown[]) {
  return Response.json({ success: true, result: { chunks }, errors: [], messages: [] });
}

function chatPayload(content: unknown = "Use the plugin.") {
  return {
    id: "chat-1",
    object: "chat.completion",
    model: "test-configured-model",
    choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content } }],
    chunks: [sourceChunk],
  };
}

function stubFetch(...responses: Array<Response | Error>) {
  const pending = [...responses];
  const fetchStub = vi.fn<typeof fetch>(async () => {
    const next = pending.shift();
    if (!next) throw new Error("Unexpected extra AI Search request");
    if (next instanceof Error) throw next;
    return next;
  });
  vi.stubGlobal("fetch", fetchStub);
  return fetchStub;
}

function requestBodies(fetchStub: ReturnType<typeof stubFetch>) {
  return fetchStub.mock.calls.map(([, init]) => JSON.parse(String(init?.body)));
}

afterEach(() => vi.unstubAllGlobals());

describe("docs-rag REST search", () => {
  it("sends explicit scoped AND retrieval and maps nonempty chunks without retry", async () => {
    const fetchStub = stubFetch(searchResponse([sourceChunk, { score: 0, text: "x".repeat(4001) }, {}]));

    expect(await searchDocs(queryEnv, { ...scopedRequest, limit: 20 })).toEqual({
      scope: "nvidia",
      matchMode: "and",
      hits: [sourceHit, { score: 0, key: null, text: "x".repeat(4000) }, { score: null, key: null, text: "" }],
    });
    expect(fetchStub).toHaveBeenCalledTimes(1);
    expect(fetchStub.mock.calls[0]).toEqual([
      `${apiUrl}/search`,
      {
        method: "POST",
        headers: {
          Authorization: "Bearer test-service-token",
          "Content-Type": "application/json; charset=utf-8",
        },
        body: expect.any(String),
      },
    ]);
    expect(requestBodies(fetchStub)).toEqual([{
      query: "TRT RTX plugin",
      ai_search_options: { retrieval: {
        max_num_results: 20,
        keyword_match_mode: "and",
        filters: { folder: { $gte: "vendor/nvidia/", $lt: "vendor/nvidia0" } },
      } },
    }]);
  });

  it("retries an empty successful AND result once with OR, preserving query, scope and limit", async () => {
    const fetchStub = stubFetch(searchResponse([]), searchResponse([sourceChunk]));

    expect(await searchDocs(queryEnv, scopedRequest)).toEqual({
      scope: "nvidia", matchMode: "or-fallback", hits: [sourceHit],
    });
    expect(fetchStub.mock.calls.map(([url]) => url)).toEqual([`${apiUrl}/search`, `${apiUrl}/search`]);
    expect(requestBodies(fetchStub)).toEqual([
      {
        query: "TRT RTX plugin",
        ai_search_options: { retrieval: {
          max_num_results: 3, keyword_match_mode: "and",
          filters: { folder: { $gte: "vendor/nvidia/", $lt: "vendor/nvidia0" } },
        } },
      },
      {
        query: "TRT RTX plugin",
        ai_search_options: { retrieval: {
          max_num_results: 3, keyword_match_mode: "or",
          filters: { folder: { $gte: "vendor/nvidia/", $lt: "vendor/nvidia0" } },
        } },
      },
    ]);
  });

  it("stops after both results are empty and keeps all unfiltered at limit 1", async () => {
    const fetchStub = stubFetch(searchResponse([]), searchResponse([]));

    expect(await searchDocs(queryEnv, { query: "rare term", scope: "all", limit: 1 })).toEqual({
      scope: "all", matchMode: "or-fallback", hits: [],
    });
    expect(fetchStub).toHaveBeenCalledTimes(2);
    expect(requestBodies(fetchStub)).toEqual([
      { query: "rare term", ai_search_options: { retrieval: { max_num_results: 1, keyword_match_mode: "and" } } },
      { query: "rare term", ai_search_options: { retrieval: { max_num_results: 1, keyword_match_mode: "or" } } },
    ]);
  });

  it.each([
    ["missing chunks", { success: true, result: {} }],
    ["null chunks", { success: true, result: { chunks: null } }],
    ["non-array chunks", { success: true, result: { chunks: {} } }],
    ["null chunk", { success: true, result: { chunks: [null] } }],
    ["non-string chunk text", { success: true, result: { chunks: [{ text: 7 }] } }],
    ["missing success", { result: { chunks: [] } }],
    ["truthy non-boolean success", { success: "true", result: { chunks: [] } }],
  ])("rejects %s without treating it as an empty result", async (_name, payload) => {
    const fetchStub = stubFetch(Response.json(payload), searchResponse([]));
    await expect(searchDocs(queryEnv, scopedRequest)).rejects.toThrow();
    expect(fetchStub).toHaveBeenCalledTimes(1);
  });
});

describe("docs-rag REST chat", () => {
  it("uses one scoped chat request and returns that completion's chunks, not separate search results", async () => {
    const fetchStub = vi.fn<typeof fetch>(async (url) => {
      if (String(url).endsWith("/search")) {
        return searchResponse([{ ...sourceChunk, text: "Unrelated retrieval", item: { key: "wrong.md" } }]);
      }
      return Response.json({ ...chatPayload(), search_query: "provider-reported query" });
    });
    vi.stubGlobal("fetch", fetchStub);

    expect(await askDocs(queryEnv, scopedRequest)).toEqual({
      scope: "nvidia", searchQuery: "provider-reported query", answer: "Use the plugin.", hits: [sourceHit],
    });
    expect(fetchStub).toHaveBeenCalledTimes(1);
    expect(fetchStub.mock.calls[0]).toEqual([
      `${apiUrl}/chat/completions`,
      {
        method: "POST",
        headers: {
          Authorization: "Bearer test-service-token",
          "Content-Type": "application/json; charset=utf-8",
        },
        body: expect.any(String),
      },
    ]);
    expect(requestBodies(fetchStub)).toEqual([{
      messages: [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: "TRT RTX plugin" }],
      model: "test-configured-model",
      ai_search_options: {
        query_rewrite: { enabled: true },
        retrieval: {
          max_num_results: 3,
          filters: { folder: { $gte: "vendor/nvidia/", $lt: "vendor/nvidia0" } },
        },
      },
    }]);
  });

  it("keeps all unfiltered and does not invent a rewritten query or retry empty chat chunks", async () => {
    const fetchStub = stubFetch(Response.json({ ...chatPayload(), chunks: [] }));
    expect(await askDocs(queryEnv, { query: "first question", scope: "all", limit: 20 })).toEqual({
      scope: "all", searchQuery: null, answer: "Use the plugin.", hits: [],
    });
    expect(fetchStub).toHaveBeenCalledTimes(1);
    expect(requestBodies(fetchStub)).toEqual([{
      messages: [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: "first question" }],
      model: "test-configured-model",
      ai_search_options: { query_rewrite: { enabled: true }, retrieval: { max_num_results: 20 } },
    }]);
  });

  it("preserves a valid empty answer and an explicitly supplied empty search query", async () => {
    const fetchStub = stubFetch(Response.json({ ...chatPayload(""), search_query: "" }));
    expect(await askDocs(queryEnv, scopedRequest)).toEqual({
      scope: "nvidia", searchQuery: "", answer: "", hits: [sourceHit],
    });
    expect(fetchStub).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["missing choices", { chunks: [] }],
    ["empty choices", { ...chatPayload(), choices: [] }],
    ["missing message", { ...chatPayload(), choices: [{}] }],
    ["missing content", { ...chatPayload(), choices: [{ message: {} }] }],
    ["null content", chatPayload(null)],
    ["numeric content", chatPayload(123)],
    ["missing chunks", { choices: [{ message: { content: "Answer" } }] }],
    ["null chunks", { ...chatPayload(), chunks: null }],
    ["non-array chunks", { ...chatPayload(), chunks: {} }],
    ["null chunk", { ...chatPayload(), chunks: [null] }],
    ["invalid chunk text", { ...chatPayload(), chunks: [{ text: 1 }] }],
    ["invalid search query", { ...chatPayload(), search_query: 123 }],
  ])("rejects %s instead of returning a successful empty answer", async (_name, payload) => {
    const fetchStub = stubFetch(Response.json(payload));
    await expect(askDocs(queryEnv, scopedRequest)).rejects.toThrow();
    expect(fetchStub.mock.calls.map(([url]) => url)).toEqual([`${apiUrl}/chat/completions`]);
  });
});

const upstreamFailures = [
  { name: "HTTP failure", status: 503, body: "unavailable", rateLimited: false },
  { name: "HTTP 429", status: 429, body: "slow down", rateLimited: true },
  { name: "compact code 2003", status: 503, body: '{"errors":[{"code":2003}]}', rateLimited: true },
  { name: "whitespace code 2003", status: 503, body: '{ "errors": [ { "code" : 2003 } ] }', rateLimited: true },
  { name: "successful HTTP with rate-limit envelope", status: 200, body: '{"success":false,"errors":[{"code": 2003}]}', rateLimited: true },
  { name: "chat rate-limit error", status: 200, body: '{"error":{"code":2003,"message":"limited"}}', rateLimited: true },
  { name: "API failure envelope", status: 200, body: '{"success":false,"errors":[{"code":1000,"message":"denied"}]}', rateLimited: false },
  { name: "API errors despite success", status: 200, body: JSON.stringify({
    ...chatPayload(), success: true, result: { chunks: [] }, errors: [{ code: 1000, message: "denied" }],
  }), rateLimited: false },
  { name: "chat error despite choices", status: 200, body: JSON.stringify({
    ...chatPayload(), error: { message: "denied" },
  }), rateLimited: false },
  { name: "invalid JSON", status: 200, body: "not JSON", rateLimited: false },
  { name: "null JSON", status: 200, body: "null", rateLimited: false },
  { name: "empty JSON", status: 200, body: "{}", rateLimited: false },
];

describe.each([
  { name: "search", run: searchDocs, path: "search" },
  { name: "chat", run: askDocs, path: "chat/completions" },
])("docs-rag $name errors", ({ run, path }) => {
  it.each(upstreamFailures)("propagates $name without fallback", async ({ status, body, rateLimited }) => {
    const fetchStub = stubFetch(new Response(body, { status }));
    const result = run(queryEnv, scopedRequest);
    await expect(result).rejects.toThrow(rateLimited ? RateLimitedError : Error);
    if (!rateLimited) await expect(result).rejects.not.toBeInstanceOf(RateLimitedError);
    expect(fetchStub.mock.calls.map(([url]) => url)).toEqual([`${apiUrl}/${path}`]);
  });

  it("propagates transport failure without fallback", async () => {
    const failure = new Error("connection failed");
    const fetchStub = stubFetch(failure);
    await expect(run(queryEnv, scopedRequest)).rejects.toBe(failure);
    expect(fetchStub.mock.calls.map(([url]) => url)).toEqual([`${apiUrl}/${path}`]);
  });
});

describe("docs-rag OR fallback errors", () => {
  it.each(upstreamFailures)("propagates $name from fallback without a third request", async ({ status, body, rateLimited }) => {
    const fetchStub = stubFetch(searchResponse([]), new Response(body, { status }));
    const result = searchDocs(queryEnv, scopedRequest);
    await expect(result).rejects.toThrow(rateLimited ? RateLimitedError : Error);
    if (!rateLimited) await expect(result).rejects.not.toBeInstanceOf(RateLimitedError);
    expect(fetchStub).toHaveBeenCalledTimes(2);
    expect(requestBodies(fetchStub)[1].ai_search_options.retrieval.keyword_match_mode).toBe("or");
  });

  it("propagates transport failure from fallback", async () => {
    const failure = new Error("fallback connection failed");
    const fetchStub = stubFetch(searchResponse([]), failure);
    await expect(searchDocs(queryEnv, scopedRequest)).rejects.toBe(failure);
    expect(fetchStub).toHaveBeenCalledTimes(2);
  });
});
