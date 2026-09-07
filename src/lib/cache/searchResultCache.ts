import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { searchCache } from "@/lib/db/schema";
import { cache as inMemoryCache } from "@/lib/resilience/cache";
import type { SearchMode, SearchResponse } from "@/lib/types/search";
import { logger } from "@/lib/log/logger";

export const SEARCH_CACHE_TTL_MS = 15 * 60_000;
/** Shorter TTL for degraded responses, so a recovering provider is reflected sooner. */
export const DEGRADED_SEARCH_CACHE_TTL_MS = 2 * 60_000;

export interface SearchCacheFilters {
  yearFrom?: number;
  yearTo?: number;
  openAccessOnly?: boolean;
  minCitations?: number;
  sources?: string[];
  /**
   * Omitted (undefined) for keyword mode so existing keyword-mode cache
   * entries/tests are unaffected (JSON.stringify drops undefined properties,
   * so `{ mode: undefined }` hashes identically to `{}`) — semantic mode gets
   * its own cache namespace for the same query text without a schema change.
   */
  mode?: SearchMode;
}

export function computeSearchCacheKey(query: string, filters: SearchCacheFilters = {}): string {
  const normalizedQuery = query.trim().toLowerCase();
  const payload = JSON.stringify({ query: normalizedQuery, filters });
  return createHash("sha256").update(payload).digest("hex");
}

/**
 * The durable cache is an accelerator, never a dependency: computing the search
 * from the providers is always possible without it. So this read gets a hard
 * budget and a miss is assumed past it.
 *
 * Without one, an unreachable database doesn't merely fail — it fails slowly and
 * with escalating slowness. postgres.js backs off between reconnect attempts,
 * and every search fires ~21 un-awaited background writes (work upserts plus a
 * health snapshot per provider) that keep the pool failing, so the backoff
 * grows. This read then queues behind it: measured at 9ms, 17s, 27s, then 44s
 * over successive searches against a dead host.
 */
const DB_READ_BUDGET_MS = 500;
const DB_READ_TIMED_OUT = Symbol("db-read-timed-out");

async function withDeadline<T>(work: Promise<T>, budgetMs: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<typeof DB_READ_TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(DB_READ_TIMED_OUT), budgetMs);
  });
  // If the deadline wins, the query is still in flight and will usually reject
  // later. Attaching a no-op handler marks that rejection handled so it can't
  // surface as an unhandled rejection after we've already returned.
  work.catch(() => {});
  try {
    return await Promise.race([work, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Read-through: checks the fast in-memory LRU first, then falls back to the
 * durable Postgres table (backfilling the LRU on a hit) so a cold in-memory
 * cache — after a restart or on a different serverless instance — still
 * benefits from a result computed recently by any instance.
 */
export async function getCachedSearchResponse(queryHash: string): Promise<SearchResponse | null> {
  const memHit = inMemoryCache.get<SearchResponse>(queryHash);
  if (memHit) return memHit;

  try {
    const rows = await withDeadline(
      getDb().select().from(searchCache).where(eq(searchCache.queryHash, queryHash)).limit(1),
      DB_READ_BUDGET_MS,
    );
    if (rows === DB_READ_TIMED_OUT) {
      logger.warn(
        { event: "search_cache_read_timed_out", queryHash, budgetMs: DB_READ_BUDGET_MS },
        "search cache DB read exceeded its budget, treating as a miss",
      );
      return null;
    }
    const row = rows[0];
    if (!row || row.expiresAt.getTime() < Date.now()) return null;

    inMemoryCache.set(queryHash, row.resultPayload, SEARCH_CACHE_TTL_MS);
    return row.resultPayload;
  } catch (err) {
    logger.warn(
      { event: "search_cache_read_failed", queryHash, err: String(err) },
      "search cache DB read failed",
    );
    return null;
  }
}

/**
 * Write-through: populates the in-memory LRU immediately (so this same process
 * benefits right away) and persists to Postgres in the background — a DB write
 * failure must never fail or delay the search request that produced this result.
 */
export function setCachedSearchResponse(
  queryHash: string,
  queryText: string,
  filters: SearchCacheFilters,
  response: SearchResponse,
  ttlMs: number = SEARCH_CACHE_TTL_MS,
): void {
  inMemoryCache.set(queryHash, response, ttlMs);

  const expiresAt = new Date(Date.now() + ttlMs);
  try {
    getDb()
      .insert(searchCache)
      .values({
        queryHash,
        queryText,
        filters: filters as Record<string, unknown>,
        resultPayload: response,
        providerStatuses: response.providerStatuses,
        expiresAt,
      })
      .onConflictDoUpdate({
        target: searchCache.queryHash,
        set: {
          resultPayload: response,
          providerStatuses: response.providerStatuses,
          filters: filters as Record<string, unknown>,
          expiresAt,
        },
      })
      .catch((err: unknown) => {
        logger.warn(
          { event: "search_cache_write_failed", queryHash, err: String(err) },
          "search cache DB write failed",
        );
      });
  } catch (err) {
    logger.warn(
      { event: "search_cache_write_failed", queryHash, err: String(err) },
      "search cache DB write failed",
    );
  }
}
