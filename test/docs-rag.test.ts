import { describe, expect, it } from "vitest";
import { bearerAuthorized, checkRateLimits, limiterKeyFromToken } from "@/docs-rag/auth";
import { parseSearchBody } from "@/docs-rag/query";
import { filterForScope } from "@/docs-rag/scopes";

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
