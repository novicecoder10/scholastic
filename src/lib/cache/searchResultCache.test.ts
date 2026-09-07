import { describe, it, expect } from "vitest";
import {
  computeSearchCacheKey,
  getCachedSearchResponse,
  setCachedSearchResponse,
} from "@/lib/cache/searchResultCache";
import type { SearchResponse } from "@/lib/types/search";

function response(overrides: Partial<SearchResponse> = {}): SearchResponse {
  return {
    query: "test query",
    results: [],
    totalEstimate: 0,
    page: 1,
    perPage: 20,
    providerStatuses: [],
    degraded: false,
    cached: false,
    ...overrides,
  };
}

describe("computeSearchCacheKey", () => {
  it("is stable for the same query and filters", () => {
    const a = computeSearchCacheKey("Transformers", { yearFrom: 2020 });
    const b = computeSearchCacheKey("Transformers", { yearFrom: 2020 });
    expect(a).toBe(b);
  });

  it("normalizes query casing and surrounding whitespace", () => {
    const a = computeSearchCacheKey("  Transformers  ");
    const b = computeSearchCacheKey("transformers");
    expect(a).toBe(b);
  });

  it("differs when filters differ", () => {
    const a = computeSearchCacheKey("transformers", { yearFrom: 2020 });
    const b = computeSearchCacheKey("transformers", { yearFrom: 2021 });
    expect(a).not.toBe(b);
  });

  it("differs for different queries", () => {
    expect(computeSearchCacheKey("a")).not.toBe(computeSearchCacheKey("b"));
  });
});

describe("search result cache (in-memory fast path, no DB configured in this test env)", () => {
  it("returns null for a key that was never set", async () => {
    const key = computeSearchCacheKey("never-set-query-xyz");
    expect(await getCachedSearchResponse(key)).toBeNull();
  });

  it("serves a set value from the in-memory cache without throwing, despite no DATABASE_URL", async () => {
    const key = computeSearchCacheKey("some-cached-query");
    const value = response({ query: "some-cached-query", totalEstimate: 3 });

    expect(() => setCachedSearchResponse(key, "some-cached-query", {}, value)).not.toThrow();

    const cached = await getCachedSearchResponse(key);
    expect(cached).toEqual(value);
  });

  it("respects a custom TTL override without throwing", () => {
    const key = computeSearchCacheKey("degraded-query");
    expect(() =>
      setCachedSearchResponse(key, "degraded-query", {}, response({ degraded: true }), 1000),
    ).not.toThrow();
  });
});
