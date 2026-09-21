/** Bindings for the docs-rag Worker. AI Search is not in workers-types yet. */

export interface DocsRagFilter {
  folder: {
    $gte: string;
    $lt: string;
  };
}

export interface AutoRagSearchOptions {
  query: string;
  max_num_results?: number;
  ranking_options?: { score_threshold?: number };
  rewrite_query?: boolean;
  filters?: DocsRagFilter;
}

export interface AutoRagAiSearchOptions extends AutoRagSearchOptions {
  model: string;
  system_prompt?: string;
}

export interface AutoRagSearchHit {
  id?: string;
  score?: number;
  content?: string;
  metadata?: {
    filename?: string;
    folder?: string;
    timestamp?: number;
  };
}

export interface AutoRagSearchResponse {
  data?: AutoRagSearchHit[];
  has_more?: boolean;
}

export interface AutoRagAiSearchResponse extends AutoRagSearchResponse {
  search_query?: string;
  response?: string;
}

/** New AI Search REST API response shape (Vectorize-style chunks). */
export interface DocsRagSearchChunk {
  id?: string;
  type?: string;
  score?: number;
  text?: string;
  item?: {
    key?: string;
    timestamp?: number;
    metadata?: Record<string, unknown>;
  };
}

export interface DocsRagSearchResult {
  query_kind?: string;
  search_query?: string;
  chunks?: DocsRagSearchChunk[];
}

export interface AutoRagBinding {
  search(options: AutoRagSearchOptions): Promise<AutoRagSearchResponse>;
  aiSearch(options: AutoRagAiSearchOptions): Promise<AutoRagAiSearchResponse>;
}

export interface AiWithAutoRag {
  autorag(instance: string): AutoRagBinding;
}

export interface DocsRagBindings {
  AI: AiWithAutoRag;
  CORPUS: R2Bucket;
  AI_SEARCH_INSTANCE: string;
  AI_SEARCH_MODEL: string;
  DOCS_RAG_TOKEN: string;
  AI_SEARCH_API_TOKEN: string;
  CF_ACCOUNT_ID: string;
}

export type DocsRagEnv = {
  Bindings: DocsRagBindings;
};
