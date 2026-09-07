import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { http, HttpResponse } from "msw";
import { readFileSync } from "node:fs";
import path from "node:path";
import { server } from "@/test/msw-server";
import { fanOutSearch } from "@/lib/providers/orchestrator";
import { crossrefAdapter } from "@/lib/providers/crossref/adapter";
import { circuitBreaker } from "@/lib/resilience/circuitBreaker";
import openAlexFixture from "@/test/fixtures/openalex-search.json";
import crossrefFixture from "@/test/fixtures/crossref-search.json";
import europePmcFixture from "@/test/fixtures/europepmc-search.json";
import doajFixture from "@/test/fixtures/doaj-search.json";
import semanticScholarFixture from "@/test/fixtures/semanticscholar-search.json";

const arxivFixtureXml = readFileSync(
  path.join(process.cwd(), "src/test/fixtures/arxiv-search.atom.xml"),
  "utf-8",
);

// Only the 6 always-enabled providers (keyed providers requiring credentials
// that aren't set in this test env — CORE, Unpaywall, PubMed — stay disabled
// and excluded from the fan-out, per their own adapter tests).
const ALL_PROVIDER_IDS = ["openalex", "crossref", "arxiv", "europepmc", "doaj", "semantic_scholar"];

// arXiv, Europe PMC, DOAJ, and Semantic Scholar succeed by default in every test
// below (registered fresh each test, since afterEach's resetHandlers() clears
// runtime handlers) — these tests focus on openalex/crossref behavior, so the
// rest just need to stay out of the way with a normal success response.
function defaultBackgroundProviderHandlers() {
  return [
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
  ];
}

describe("fanOutSearch", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    for (const id of ALL_PROVIDER_IDS) circuitBreaker.reset(id);
    server.use(...defaultBackgroundProviderHandlers());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 'ok' results for every provider when all succeed", async () => {
    server.use(
      http.get("https://api.openalex.org/works", () => HttpResponse.json(openAlexFixture)),
      http.get("https://api.crossref.org/works", () => HttpResponse.json(crossrefFixture)),
    );

    const results = await fanOutSearch({ query: "unique-query-all-ok" });

    expect(results).toHaveLength(6);
    expect(results.every((r) => r.status === "ok")).toBe(true);
    const openAlexResult = results.find((r) => r.providerId === "openalex")!;
    const crossrefResult = results.find((r) => r.providerId === "crossref")!;
    expect(openAlexResult.works.length).toBeGreaterThan(0);
    expect(crossrefResult.works.length).toBeGreaterThan(0);
  });

  it("marks a failing provider as 'error' while other providers still succeed (graceful degradation)", async () => {
    server.use(
      http.get("https://api.openalex.org/works", () => HttpResponse.json(openAlexFixture)),
      http.get("https://api.crossref.org/works", () => HttpResponse.error()),
    );

    const promise = fanOutSearch({ query: "unique-query-partial-fail" });
    await vi.advanceTimersByTimeAsync(10_000);
    const results = await promise;

    const openAlexResult = results.find((r) => r.providerId === "openalex")!;
    const crossrefResult = results.find((r) => r.providerId === "crossref")!;
    expect(openAlexResult.status).toBe("ok");
    expect(crossrefResult.status).toBe("error");
    expect(crossrefResult.works).toEqual([]);
  });

  it("marks a hanging provider as 'timeout' without blocking the other provider's result", async () => {
    // Real timers here, not fake ones: this test exercises a genuinely-hanging
    // network mock through real fetch/undici, which doesn't reliably observe
    // vitest's faked setTimeout. A short real defaultTimeoutMs override keeps
    // it fast without needing fake timers.
    vi.useRealTimers();
    const originalTimeout = crossrefAdapter.meta.defaultTimeoutMs;
    crossrefAdapter.meta.defaultTimeoutMs = 100;

    server.use(
      http.get("https://api.openalex.org/works", () => HttpResponse.json(openAlexFixture)),
      http.get(
        "https://api.crossref.org/works",
        () => new Promise(() => {}), // never resolves
      ),
    );

    try {
      const results = await fanOutSearch({ query: "unique-query-timeout" });

      const openAlexResult = results.find((r) => r.providerId === "openalex")!;
      const crossrefResult = results.find((r) => r.providerId === "crossref")!;
      expect(openAlexResult.status).toBe("ok");
      expect(crossrefResult.status).toBe("timeout");
    } finally {
      crossrefAdapter.meta.defaultTimeoutMs = originalTimeout;
    }
  });

  it("returns the fast providers' results when one provider outlives the whole fan-out budget", async () => {
    // Real timers, same reason as the test above: a genuinely-hanging network
    // mock goes through real fetch/undici, which doesn't observe faked timers.
    vi.useRealTimers();
    const originalTimeout = crossrefAdapter.meta.defaultTimeoutMs;
    // Far higher than the injected budget, so the only thing that can end this
    // provider's call is the fan-out deadline — not its own per-provider timeout.
    crossrefAdapter.meta.defaultTimeoutMs = 60_000;

    server.use(
      http.get("https://api.openalex.org/works", () => HttpResponse.json(openAlexFixture)),
      http.get(
        "https://api.crossref.org/works",
        () => new Promise(() => {}), // never resolves
      ),
    );

    try {
      const started = Date.now();
      const results = await fanOutSearch(
        { query: "unique-query-fanout-budget" },
        {
          deadlineMs: 200,
        },
      );
      const elapsed = Date.now() - started;

      const openAlexResult = results.find((r) => r.providerId === "openalex")!;
      const crossrefResult = results.find((r) => r.providerId === "crossref")!;
      expect(openAlexResult.status).toBe("ok");
      expect(openAlexResult.works.length).toBeGreaterThan(0);
      expect(crossrefResult.status).toBe("timeout");
      expect(crossrefResult.errorMessage).toContain("fan-out budget");
      // The whole point: the straggler doesn't get to hold the request open.
      expect(elapsed).toBeLessThan(5_000);
    } finally {
      crossrefAdapter.meta.defaultTimeoutMs = originalTimeout;
    }
  });

  it("trips the circuit breaker after repeated failures and skips the provider without a network call", async () => {
    let crossrefCallCount = 0;
    server.use(
      http.get("https://api.openalex.org/works", () => HttpResponse.json(openAlexFixture)),
      http.get("https://api.crossref.org/works", () => {
        crossrefCallCount += 1;
        return HttpResponse.error();
      }),
    );

    // withResilience calls circuitBreaker.recordFailure once per fanOutSearch
    // call (after its internal retries are exhausted), so 5 calls are needed to
    // reach the 5-consecutive-failure trip threshold.
    for (let i = 0; i < 5; i++) {
      const promise = fanOutSearch({ query: `unique-query-breaker-${i}` });
      await vi.advanceTimersByTimeAsync(10_000);
      await promise;
    }

    expect(circuitBreaker.getState("crossref")).toBe("open");
    const callCountBeforeSkip = crossrefCallCount;

    const promise = fanOutSearch({ query: "unique-query-breaker-final" });
    await vi.advanceTimersByTimeAsync(10_000);
    const results = await promise;

    const crossrefResult = results.find((r) => r.providerId === "crossref")!;
    expect(crossrefResult.status).toBe("skipped");
    expect(crossrefCallCount).toBe(callCountBeforeSkip); // no new network call attempted
  });
});
