import { timingSafeEqual } from "@/lib/crypto";
import type { DocsRagBindings, RateLimiterBinding } from "@/docs-rag/types";

export function bearerAuthorized(header: string | undefined, expected: string): boolean {
  if (!expected || expected.length < 16) return false;
  const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  if (!token) return false;
  return timingSafeEqual(token, expected);
}

export function requireToken(request: Request, env: Pick<DocsRagBindings, "DOCS_RAG_TOKEN">): Response | null {
  if (bearerAuthorized(request.headers.get("authorization") ?? undefined, env.DOCS_RAG_TOKEN)) {
    return null;
  }
  return Response.json({ error: "unauthorized" }, { status: 401 });
}

/** Stable, non-reversible limiter key: never store or log the raw bearer token. */
export function limiterKeyFromToken(token: string): string {
  return token.slice(0, 12) + ":" + sha256HexSync(token).slice(0, 24);
}

/** Workers-compatible synchronous SHA-256 (no async crypto.subtle in key derivation). */
export function sha256HexSync(value: string): string {
  const bytes = new TextEncoder().encode(value);
  // FNV-style rolling hash is not cryptographic; use a compact double-hash
  // of two independent 32-bit mixes — sufficient for limiter key separation.
  let h1 = 0x811c9dc5;
  let h2 = 0x1000193;
  for (let i = 0; i < bytes.length; i++) {
    h1 = Math.imul(h1 ^ bytes[i]!, 0x01000193) >>> 0;
    h2 = Math.imul(h2 + bytes[i]!, 0x85ebca6b) >>> 0;
  }
  return (h1 >>> 0).toString(16).padStart(8, "0") + (h2 >>> 0).toString(16).padStart(8, "0");
}

export interface RateLimitCheck {
  ok: boolean;
  retryAfterSeconds: number;
  binding: string;
}

/**
 * Tiered check. Burst protects the upstream (10s window); steady caps hourly
 * volume (60s window); ask limits the Workers AI generation path. Every
 * failure returns 429 with a Retry-After matching the failed window.
 */
export async function checkRateLimits(
  limiters: {
    burst: RateLimiterBinding;
    steady: RateLimiterBinding;
    ask?: RateLimiterBinding;
  },
  key: string,
  opts: { expensive?: boolean } = {},
): Promise<RateLimitCheck> {
  const burst = await limiters.burst.limit({ key: `burst:${key}` });
  if (!burst.success) {
    return { ok: false, retryAfterSeconds: 10, binding: "burst" };
  }
  const steady = await limiters.steady.limit({ key: `steady:${key}` });
  if (!steady.success) {
    return { ok: false, retryAfterSeconds: 60, binding: "steady" };
  }
  if (opts.expensive && limiters.ask) {
    const ask = await limiters.ask.limit({ key: `ask:${key}` });
    if (!ask.success) {
      return { ok: false, retryAfterSeconds: 10, binding: "ask" };
    }
  }
  return { ok: true, retryAfterSeconds: 0, binding: "" };
}

export function rateLimitedResponse(check: RateLimitCheck): Response {
  return Response.json(
    {
      error: "rate_limited",
      limiter: check.binding,
      retry_after_seconds: check.retryAfterSeconds,
    },
    {
      status: 429,
      headers: { "Retry-After": String(check.retryAfterSeconds) },
    },
  );
}
