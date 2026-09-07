import { describe, it, expect, beforeEach, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { readFileSync } from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { server } from "@/test/msw-server";
import { GET } from "@/app/api/search/route";
import { circuitBreaker } from "@/lib/resilience/circuitBreaker";

// Semantic mode's actual ranking depends on a real embedding backend (hosted
// API or a downloaded local model) — mocked here so route-level wiring tests
// stay fast and network-independent, consistent with this suite's existing
// MSW-only-external-IO convention. Real embedding behavior is covered by
// semanticRank.test.ts and embeddings/*.test.ts, and live-verified manually.
// (vi.mock calls are hoisted above imports by Vitest, so this applies even
// though GET is imported above.)
const rankBySemanticSimilarityMock = vi.fn();
vi.mock("@/lib/ai/semanticRank", () => ({
  rankBySemanticSimilarity: (...args: unknown[]) => rankBySemanticSimilarityMock(...args),
}));
import openAlexFixture from "@/test/fixtures/openalex-search.json";
import crossrefFixture from "@/test/fixtures/crossref-search.json";
import europePmcFixture from "@/test/fixtures/europepmc-search.json";
import doajFixture from "@/test/fixtures/doaj-search.json";
import semanticScholarFixture from "@/test/fixtures/semanticscholar-search.json";

const arxivFixtureXml = readFileSync(
  path.join(process.cwd(), "src/test/fixtures/arxiv-search.atom.xml"),
  "utf-8",
);

const ALWAYS_ENABLED_PROVIDER_IDS = [
  "openalex",
  "crossref",
  "arxiv",
  "europepmc",
  "doaj",
  "semantic_scholar",
];

function registerAllSucceedHandlers() {
  server.use(
    http.get("https://api.openalex.org/works", () => HttpResponse.json(openAlexFixture)),
    http.get("https://api.crossref.org/works", () => HttpResponse.json(crossrefFixture)),
    http.get("http://export.arxiv.org/api/query", () => {
      return new HttpResponse(arxivFixtureXml, {
        headers: { "Content-Type": "application/atom+xml" },
      });
    }),
    http.get("https://www.ebi.ac.uk/europepmc/webservices/rest/search", () =>
      HttpResponse.json(europePmcFixture),
    ),
    http.get("https://doaj.org/api/search/articles/:query", () => HttpResponse.json(doajFixture)),
    http.get("https://api.semanticscholar.org/graph/v1/paper/search", () =>
      HttpResponse.json(semanticScholarFixture),
    ),
  );
}

function makeRequest(searchParams: string): NextRequest {
  return new NextRequest(new URL(`http://localhost:3000/api/search?${searchParams}`));
}

describe("GET /api/search", () => {
  beforeEach(() => {
    for (const id of ALWAYS_ENABLED_PROVIDER_IDS) circuitBreaker.reset(id);
    // Each test uses a distinct query string so the DB-less in-memory cache
    // (which persists across tests within this file) never serves a stale hit.
    rankBySemanticSimilarityMock.mockReset();
  });

  it("returns 400 when the 'q' parameter is missing", async () => {
    const response = await GET(makeRequest(""));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toMatch(/required/i);
  });

  it("returns 400 when 'q' is only whitespace", async () => {
    const response = await GET(makeRequest("q=%20%20"));
    expect(response.status).toBe(400);
  });

  it("returns 200 with deduped, ranked results when every provider succeeds", async () => {
    registerAllSucceedHandlers();

    const response = await GET(makeRequest("q=route-test-all-ok"));
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.query).toBe("route-test-all-ok");
    expect(body.degraded).toBe(false);
    expect(body.cached).toBe(false);
    expect(body.results.length).toBeGreaterThan(0);
    expect(body.providerStatuses).toHaveLength(6);
    expect(body.providerStatuses.every((p: { status: string }) => p.status === "ok")).toBe(true);
  });

  it("returns 200 with degraded:true (never a 5xx) when some providers fail", async () => {
    server.use(
      http.get("https://api.openalex.org/works", () => HttpResponse.json(openAlexFixture)),
      http.get("https://api.crossref.org/works", () => HttpResponse.error()),
      http.get("http://export.arxiv.org/api/query", () => {
        return new HttpResponse(arxivFixtureXml, {
          headers: { "Content-Type": "application/atom+xml" },
        });
      }),
      http.get("https://www.ebi.ac.uk/europepmc/webservices/rest/search", () =>
        HttpResponse.json(europePmcFixture),
      ),
      http.get("https://doaj.org/api/search/articles/:query", () => HttpResponse.json(doajFixture)),
      http.get("https://api.semanticscholar.org/graph/v1/paper/search", () =>
        HttpResponse.json(semanticScholarFixture),
      ),
    );

    const response = await GET(makeRequest("q=paper-route-test-partial-fail"));
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.degraded).toBe(true);
    expect(body.results.length).toBeGreaterThan(0);
    const crossrefStatus = body.providerStatuses.find(
      (p: { providerId: string }) => p.providerId === "crossref",
    );
    expect(crossrefStatus.status).toBe("error");
  });

  it("returns 200 with empty results (never a 5xx) when every provider fails", async () => {
    for (const [url] of [
      ["https://api.openalex.org/works"],
      ["https://api.crossref.org/works"],
      ["http://export.arxiv.org/api/query"],
      ["https://www.ebi.ac.uk/europepmc/webservices/rest/search"],
      ["https://doaj.org/api/search/articles/:query"],
      ["https://api.semanticscholar.org/graph/v1/paper/search"],
    ]) {
      server.use(http.get(url, () => HttpResponse.error()));
    }

    const response = await GET(makeRequest("q=route-test-all-fail"));
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.degraded).toBe(true);
    expect(body.results).toEqual([]);
    expect(body.providerStatuses.every((p: { status: string }) => p.status !== "ok")).toBe(true);
  });

  it("applies minCitations and openAccessOnly filters from query params", async () => {
    registerAllSucceedHandlers();

    const unfiltered = await GET(makeRequest("q=route-test-filters"));
    const unfilteredBody = await unfiltered.json();

    const filtered = await GET(
      makeRequest("q=route-test-filters&minCitations=100000&openAccessOnly=true"),
    );
    const filteredBody = await filtered.json();

    expect(filteredBody.results.length).toBeLessThanOrEqual(unfilteredBody.results.length);
    for (const work of filteredBody.results) {
      expect(work.isOpenAccess).toBe(true);
      expect(work.citationCount).toBeGreaterThanOrEqual(100000);
    }
  });

  it("paginates results according to page/perPage", async () => {
    registerAllSucceedHandlers();

    const page1 = await GET(makeRequest("q=paper-route-test-pagination&page=1&perPage=2"));
    const page1Body = await page1.json();
    const page2 = await GET(makeRequest("q=paper-route-test-pagination&page=2&perPage=2"));
    const page2Body = await page2.json();

    expect(page1Body.results).toHaveLength(2);
    expect(page1Body.page).toBe(1);
    expect(page1Body.perPage).toBe(2);
    expect(page2Body.page).toBe(2);
    // Cached base result set + fresh pagination means page 2 shouldn't repeat page 1's ids.
    const page1Ids = page1Body.results.map((w: { id: string }) => w.id);
    const page2Ids = page2Body.results.map((w: { id: string }) => w.id);
    expect(page1Ids.some((id: string) => page2Ids.includes(id))).toBe(false);
  });

  it("serves the second identical request from cache", async () => {
    registerAllSucceedHandlers();

    const first = await GET(makeRequest("q=route-test-cache-hit"));
    const firstBody = await first.json();
    expect(firstBody.cached).toBe(false);

    const second = await GET(makeRequest("q=route-test-cache-hit"));
    const secondBody = await second.json();
    expect(secondBody.cached).toBe(true);
    expect(secondBody.results).toEqual(firstBody.results);
  });

  it("uses semantic ranking when mode=semantic is passed", async () => {
    registerAllSucceedHandlers();
    rankBySemanticSimilarityMock.mockImplementation(async (works: unknown[]) => works);

    const response = await GET(makeRequest("q=route-test-semantic-mode&mode=semantic"));
    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.degraded).toBe(false);
    expect(rankBySemanticSimilarityMock).toHaveBeenCalledTimes(1);
    expect(rankBySemanticSimilarityMock.mock.calls[0][1]).toBe("route-test-semantic-mode");
  });

  it("defaults to keyword ranking (never calls semantic ranking) when mode is omitted", async () => {
    registerAllSucceedHandlers();
    await GET(makeRequest("q=route-test-default-mode"));
    expect(rankBySemanticSimilarityMock).not.toHaveBeenCalled();
  });

  it("falls back to keyword ranking and reports degraded:true when semantic ranking fails", async () => {
    registerAllSucceedHandlers();
    rankBySemanticSimilarityMock.mockRejectedValue(new Error("embedding backend unavailable"));

    const response = await GET(makeRequest("q=paper-route-test-semantic-fallback&mode=semantic"));
    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.degraded).toBe(true);
    expect(body.results.length).toBeGreaterThan(0);
  });

  it("caches semantic-mode and keyword-mode results separately for the same query text", async () => {
    registerAllSucceedHandlers();
    rankBySemanticSimilarityMock.mockImplementation(async (works: unknown[]) => works);

    const keywordResponse = await GET(makeRequest("q=route-test-mode-namespacing"));
    const keywordBody = await keywordResponse.json();
    expect(keywordBody.cached).toBe(false);

    const semanticResponse = await GET(makeRequest("q=route-test-mode-namespacing&mode=semantic"));
    const semanticBody = await semanticResponse.json();
    // Different mode for the same query text must not be served from the
    // keyword-mode cache entry computed just above.
    expect(semanticBody.cached).toBe(false);
  });
});
