import type { DocsRagSearchChunk, DocsRagSearchResult } from "@/docs-rag/types";

/** Max R2 object size accepted by AI Search indexing (matches corpus cap). */
const MAX_DOC_BYTES = 4_000_000;

export interface DocResult {
  found: boolean;
  key: string;
  size?: number;
  truncated?: boolean;
  text?: string;
  message?: string;
}

/**
 * Read one corpus document straight from R2. Complements search: when a
 * chunk is truncated, the agent can pull the full page by item.key.
 */
export async function getDocText(env: { CORPUS: R2Bucket }, key: string, maxChars: number): Promise<DocResult> {
  if (!key || key.includes("..") || key.startsWith("/")) {
    return { found: false, key, message: "invalid key" };
  }
  const object = await env.CORPUS.get(key);
  if (!object) {
    return { found: false, key, message: "not found in corpus bucket" };
  }
  if (object.size > MAX_DOC_BYTES) {
    return { found: false, key, size: object.size, message: "file exceeds 4MB corpus cap" };
  }
  const text = await object.text();
  const truncated = text.length > maxChars;
  return {
    found: true,
    key,
    size: object.size,
    truncated,
    text: truncated ? text.slice(0, maxChars) : text,
  };
}
