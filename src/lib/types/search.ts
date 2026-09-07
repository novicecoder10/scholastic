import type { CanonicalWork } from "@/lib/types/work";

export type SearchMode = "keyword" | "semantic";

export interface SearchRequest {
  q: string;
  /**
   * "keyword" (default): rank by token-overlap relevance. "semantic": rank by
   * embedding cosine similarity over the same live candidate pool — see
   * ARCHITECTURE.md's semantic search section for what this does and doesn't
   * do (it is not a pre-built index over all of scholarship).
   */
  mode?: SearchMode;
  page?: number;
  perPage?: number;
  yearFrom?: number;
  yearTo?: number;
  openAccessOnly?: boolean;
  minCitations?: number;
  /** Provider ids to restrict to; omit for all enabled providers. */
  sources?: string[];
  /** Exact venue/journal name(s) to restrict to; omit for all venues. */
  venues?: string[];
}

export type ProviderCallStatus = "ok" | "error" | "timeout" | "skipped" | "disabled";

export interface ProviderStatusEntry {
  providerId: string;
  displayName: string;
  status: ProviderCallStatus;
  resultCount: number;
  latencyMs: number;
  errorMessage?: string;
}

export interface SearchResponse {
  query: string;
  results: CanonicalWork[];
  /** Best-effort estimate; a true cross-source total is not knowable after dedup. */
  totalEstimate: number;
  page: number;
  perPage: number;
  providerStatuses: ProviderStatusEntry[];
  /** True if any enabled provider failed or timed out for this request. */
  degraded: boolean;
  cached: boolean;
}
