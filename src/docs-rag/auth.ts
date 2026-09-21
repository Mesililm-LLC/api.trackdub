import { timingSafeEqual } from "@/lib/crypto";
import type { DocsRagBindings } from "@/docs-rag/types";

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
