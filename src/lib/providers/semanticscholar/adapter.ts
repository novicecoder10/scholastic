import type { ProviderAdapter, RawSearchResult, SearchOptions } from "@/lib/providers/types";
import {
  mapSemanticScholarPaper,
  type SemanticScholarResponse,
} from "@/lib/providers/semanticscholar/mapper";

const BASE_URL = "https://api.semanticscholar.org/graph/v1/paper/search";
const FIELDS =
  "title,abstract,year,venue,citationCount,openAccessPdf,externalIds,authors.name,authors.externalIds";

export const semanticScholarAdapter: ProviderAdapter = {
  meta: {
    id: "semantic_scholar",
    displayName: "Semantic Scholar",
    // Works unauthenticated, just rate-limited harder — not a hard requirement.
    requiresCredential: false,
    isEnabled: true,
  },

  isConfigured() {
    return true;
  },

  async search(options: SearchOptions): Promise<RawSearchResult> {
    const limit = Math.min(options.perPage ?? 20, 100);
    const page = options.page ?? 1;
    const offset = (page - 1) * limit;

    const url = new URL(BASE_URL);
    url.searchParams.set("query", options.query);
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("offset", String(offset));
    url.searchParams.set("fields", FIELDS);
    if (options.yearFrom || options.yearTo) {
      const from = options.yearFrom ?? "";
      const to = options.yearTo ?? "";
      url.searchParams.set("year", `${from}-${to}`);
    }

    if (!options.signal) {
      throw new Error("semanticScholarAdapter.search requires an AbortSignal");
    }

    const headers: Record<string, string> = {};
    if (process.env.SEMANTIC_SCHOLAR_API_KEY) {
      headers["x-api-key"] = process.env.SEMANTIC_SCHOLAR_API_KEY;
    }

    const response = await fetch(url, { signal: options.signal, headers });
    if (!response.ok) {
      // S2 returns 200-with-empty-data for zero-result queries, so any non-OK
      // status here (incl. 429 rate limit) is a genuine failure.
      throw new Error(`Request to ${url} failed with status ${response.status}`);
    }
    const data = (await response.json()) as SemanticScholarResponse;

    return {
      works: (data.data ?? []).map(mapSemanticScholarPaper),
      totalCount: data.total ?? null,
    };
  },
};
