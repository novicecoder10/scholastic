import { fanOutSearch } from "@/lib/providers/orchestrator";
import { mergeWorks, rankWorks } from "@/lib/merge";
import { filterWorks, type WorkFilters } from "@/lib/merge/filter";
import { rankBySemanticSimilarity } from "@/lib/ai/semanticRank";
import {
  computeSearchCacheKey,
  getCachedSearchResponse,
  setCachedSearchResponse,
  SEARCH_CACHE_TTL_MS,
  DEGRADED_SEARCH_CACHE_TTL_MS,
} from "@/lib/cache/searchResultCache";
import { persistWorks } from "@/lib/db/workPersistence";
import type { CanonicalWork } from "@/lib/types/work";
import type { SearchMode, SearchRequest, SearchResponse } from "@/lib/types/search";
import { logger } from "@/lib/log/logger";

const DEFAULT_PER_PAGE = 20;
const MAX_PER_PAGE = 100;

/**
 * The single entry point for running a search: cache check -> provider fan-out
 * -> dedupe/merge -> rank -> cache write -> filter -> paginate. Shared by the
 * /api/search route handler and the search page's Server Component, so the
 * initial SSR render calls this directly instead of the page fetching its own
 * API route over the network.
 *
 * The cache stores the full merged+ranked result set keyed only by the query
 * text and mode (not filters/pagination) — filters and pagination are cheap
 * in-memory operations applied fresh on every call, so one cached entry serves
 * every filter/page combination for a given query+mode instead of needing a
 * separate cache entry per combination.
 */
export async function performSearch(request: SearchRequest): Promise<SearchResponse> {
  const query = request.q.trim();
  const mode: SearchMode = request.mode ?? "keyword";
  const page = Math.max(request.page ?? 1, 1);
  const perPage = Math.min(Math.max(request.perPage ?? DEFAULT_PER_PAGE, 1), MAX_PER_PAGE);
  const filters: WorkFilters = {
    yearFrom: request.yearFrom,
    yearTo: request.yearTo,
    openAccessOnly: request.openAccessOnly,
    minCitations: request.minCitations,
    sources: request.sources,
    venues: request.venues,
  };

  const queryHash = computeSearchCacheKey(query, { mode: mode === "semantic" ? mode : undefined });
  const cachedBase = await getCachedSearchResponse(queryHash);

  const base = cachedBase ?? (await computeBaseSearchResponse(query, mode, queryHash));
  const cached = cachedBase != null;

  const filtered = filterWorks(base.results, filters);
  const start = (page - 1) * perPage;
  const paginated = filtered.slice(start, start + perPage);

  return {
    query,
    results: paginated,
    totalEstimate: filtered.length,
    page,
    perPage,
    degraded: base.degraded,
    cached,
    providerStatuses: base.providerStatuses,
  };
}

/**
 * Runs the actual fan-out/merge/rank pipeline for a query and caches the
 * unfiltered, unpaginated result set. Only called on a cache miss.
 */
async function computeBaseSearchResponse(
  query: string,
  mode: SearchMode,
  queryHash: string,
): Promise<SearchResponse> {
  const start = Date.now();
  const providerResults = await fanOutSearch({ query });
  const latencyMs = Date.now() - start;

  const succeeded = providerResults.filter((r) => r.status === "ok").length;
  let degraded = providerResults.some((r) => r.status !== "ok");
  const merged = mergeWorks(providerResults.flatMap((r) => r.works));

  let results: CanonicalWork[];
  if (mode === "semantic") {
    try {
      results = await rankBySemanticSimilarity(merged, query);
    } catch (err) {
      // Semantic ranking depends on an embedding backend that can fail (a
      // flaky hosted API, a local-model load hiccup) — never let that fail
      // the whole search. Fall back to keyword ranking, same "one component's
      // failure never fails the overall search" contract as provider fan-out.
      logger.warn(
        { event: "semantic_rank_failed", query, err: String(err) },
        "semantic ranking failed, falling back to keyword ranking",
      );
      results = rankWorks(merged, query);
      degraded = true;
    }
  } else {
    results = rankWorks(merged, query);
  }

  logger.info(
    {
      event: "search_request",
      query,
      mode,
      latencyMs,
      providerCount: providerResults.length,
      succeededCount: succeeded,
      rawResultCount: providerResults.reduce((sum, r) => sum + r.works.length, 0),
      mergedResultCount: results.length,
      degraded,
      cached: false,
    },
    "search request completed",
  );

  const base: SearchResponse = {
    query,
    results,
    totalEstimate: results.length,
    page: 1,
    perPage: results.length,
    degraded,
    cached: false,
    providerStatuses: providerResults.map((r) => ({
      providerId: r.providerId,
      displayName: r.displayName,
      status: r.status,
      resultCount: r.works.length,
      latencyMs: r.latencyMs,
      errorMessage: r.errorMessage,
    })),
  };

  setCachedSearchResponse(
    queryHash,
    query,
    { mode: mode === "semantic" ? mode : undefined },
    base,
    degraded ? DEGRADED_SEARCH_CACHE_TTL_MS : SEARCH_CACHE_TTL_MS,
  );
  persistWorks(results);

  return base;
}
