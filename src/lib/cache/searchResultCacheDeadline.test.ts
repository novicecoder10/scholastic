import { describe, it, expect, vi } from "vitest";

// A durable-cache read that hangs (an unreachable or badly backed-up Postgres)
// must not hold the search request open — it degrades to a cache miss instead.
// Lives in its own file because vi.mock is hoisted file-wide.
vi.mock("@/lib/db/client", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => new Promise(() => {}), // never settles
        }),
      }),
    }),
  }),
}));

const { computeSearchCacheKey, getCachedSearchResponse } =
  await import("@/lib/cache/searchResultCache");

describe("search result cache durable-read budget", () => {
  it("gives up on a hanging DB read and reports a miss", async () => {
    const key = computeSearchCacheKey("hanging-db-read-query");

    const started = Date.now();
    const result = await getCachedSearchResponse(key);
    const elapsed = Date.now() - started;

    expect(result).toBeNull();
    // The budget is 500ms; the point is that it returns at all rather than
    // waiting on the DB for the length of the request.
    expect(elapsed).toBeLessThan(3_000);
  });
});
