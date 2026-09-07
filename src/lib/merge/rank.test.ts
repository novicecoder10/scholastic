import { describe, it, expect } from "vitest";
import type { CanonicalWork } from "@/lib/types/work";
import {
  scoreWork,
  rankWorks,
  relevanceScore,
  scoreWorkBySimilarity,
  rankWorksBySimilarity,
  MIN_SEMANTIC_SIMILARITY,
} from "@/lib/merge/rank";

function canonicalWork(overrides: Partial<CanonicalWork>): CanonicalWork {
  return {
    id: "1",
    workKey: "test-key",
    doi: null,
    title: "A Paper",
    abstract: null,
    authors: [],
    year: 2020,
    venue: null,
    citationCount: 0,
    isOpenAccess: false,
    pdfUrl: null,
    landingPageUrl: null,
    sources: [{ sourceId: "test", sourceRecordId: "1", citationCount: 0 }],
    bibliographic: null,
    topics: [],
    score: 0,
    ...overrides,
  };
}

const NOW = new Date("2026-01-01T00:00:00Z");
// Shared query term that matches every fixture's default title ("A Paper"),
// so relevance stays constant across compared works in tests that are only
// exercising the *other* scoring terms (citations, recency, sources, OA).
const QUERY = "paper";

describe("relevanceScore", () => {
  it("is neutral (1) for an empty query", () => {
    expect(relevanceScore("", canonicalWork({ title: "Anything" }))).toBe(1);
  });

  it("is 0 when the work shares no terms with the query anywhere", () => {
    const work = canonicalWork({
      title: "Adam: A Method for Stochastic Optimization",
      authors: [{ name: "Diederik P. Kingma" }, { name: "Jimmy Ba" }],
      abstract: "We introduce Adam, an algorithm for first-order gradient-based optimization.",
    });
    expect(relevanceScore("Geoffrey Hinton", work)).toBe(0);
  });

  it("scores an author-name match as relevant even with a sparse title", () => {
    const work = canonicalWork({
      title: "Deep Learning—A Technology With the Potential to Transform Health Care",
      authors: [{ name: "Geoffrey E. Hinton" }],
    });
    expect(relevanceScore("Geoffrey Hinton", work)).toBeGreaterThan(0);
  });

  it("scores a title match higher than a mere abstract mention", () => {
    const titleMatch = canonicalWork({ title: "The Architectures of Geoffrey Hinton" });
    const abstractOnlyMatch = canonicalWork({
      title: "A Survey of Deep Learning",
      abstract: "This survey discusses the work of Geoffrey Hinton among others.",
    });
    expect(relevanceScore("Geoffrey Hinton", titleMatch)).toBeGreaterThan(
      relevanceScore("Geoffrey Hinton", abstractOnlyMatch),
    );
  });
});

describe("scoreWork", () => {
  it("is monotonically increasing in citation count, all else equal", () => {
    const low = scoreWork(canonicalWork({ citationCount: 10 }), QUERY, NOW);
    const high = scoreWork(canonicalWork({ citationCount: 1000 }), QUERY, NOW);
    expect(high).toBeGreaterThan(low);
  });

  it("scores works with more corroborating sources higher, all else equal", () => {
    const oneSource = scoreWork(
      canonicalWork({ sources: [{ sourceId: "a", sourceRecordId: "1", citationCount: null }] }),
      QUERY,
      NOW,
    );
    const threeSources = scoreWork(
      canonicalWork({
        sources: [
          { sourceId: "a", sourceRecordId: "1", citationCount: null },
          { sourceId: "b", sourceRecordId: "1", citationCount: null },
          { sourceId: "c", sourceRecordId: "1", citationCount: null },
        ],
      }),
      QUERY,
      NOW,
    );
    expect(threeSources).toBeGreaterThan(oneSource);
  });

  it("scores more recent works higher, all else equal", () => {
    const older = scoreWork(canonicalWork({ year: 2000 }), QUERY, NOW);
    const recent = scoreWork(canonicalWork({ year: 2025 }), QUERY, NOW);
    expect(recent).toBeGreaterThan(older);
  });

  it("does not let recency decay go negative for very old works", () => {
    const ancient = scoreWork(canonicalWork({ year: 1900, citationCount: 100 }), QUERY, NOW);
    const old = scoreWork(canonicalWork({ year: 1990, citationCount: 100 }), QUERY, NOW);
    // Both should have recencyBoost clamped to 0, so their scores should be equal,
    // not have "ancient" penalized further than "old" (decay floors at 0).
    expect(ancient).toBeCloseTo(old, 5);
  });

  it("gives a boost to open-access works, all else equal", () => {
    const closed = scoreWork(canonicalWork({ isOpenAccess: false }), QUERY, NOW);
    const open = scoreWork(canonicalWork({ isOpenAccess: true }), QUERY, NOW);
    expect(open).toBeGreaterThan(closed);
  });

  it("treats a null year as no recency boost, not a crash", () => {
    expect(() => scoreWork(canonicalWork({ year: null }), QUERY, NOW)).not.toThrow();
  });

  it("scores a relevant-but-less-cited work higher than an irrelevant-but-highly-cited one", () => {
    const relevant = scoreWork(
      canonicalWork({ title: "The Architectures of Geoffrey Hinton", citationCount: 11 }),
      "Geoffrey Hinton",
      NOW,
    );
    const irrelevant = scoreWork(
      canonicalWork({
        title: "Adam: A Method for Stochastic Optimization",
        authors: [{ name: "Diederik P. Kingma" }, { name: "Jimmy Ba" }],
        citationCount: 84794,
      }),
      "Geoffrey Hinton",
      NOW,
    );
    expect(relevant).toBeGreaterThan(irrelevant);
  });
});

describe("rankWorks", () => {
  it("sorts works highest-scoring first and assigns the score field", () => {
    const works = [
      canonicalWork({ id: "low", citationCount: 1 }),
      canonicalWork({ id: "high", citationCount: 10000 }),
      canonicalWork({ id: "mid", citationCount: 100 }),
    ];

    const ranked = rankWorks(works, QUERY, NOW);
    expect(ranked.map((w) => w.id)).toEqual(["high", "mid", "low"]);
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score);
    expect(ranked[1].score).toBeGreaterThan(ranked[2].score);
  });

  it("drops works that share zero terms with the query, regardless of citation count", () => {
    const relevant = canonicalWork({
      id: "relevant",
      title: "Geoffrey Hinton's Contributions",
      citationCount: 5,
    });
    const irrelevant = canonicalWork({
      id: "irrelevant",
      title: "Elements of Statistical Learning",
      authors: [{ name: "Trevor Hastie" }],
      citationCount: 24367,
    });

    const ranked = rankWorks([relevant, irrelevant], "Geoffrey Hinton", NOW);
    expect(ranked.map((w) => w.id)).toEqual(["relevant"]);
  });
});

describe("scoreWorkBySimilarity", () => {
  it("is monotonically increasing in similarity, all else equal", () => {
    const low = scoreWorkBySimilarity(canonicalWork({}), 0.3, NOW);
    const high = scoreWorkBySimilarity(canonicalWork({}), 0.9, NOW);
    expect(high).toBeGreaterThan(low);
  });

  it("still lets citation count/recency/OA break ties among similarly-similar works", () => {
    const lowCitations = scoreWorkBySimilarity(canonicalWork({ citationCount: 10 }), 0.5, NOW);
    const highCitations = scoreWorkBySimilarity(canonicalWork({ citationCount: 10000 }), 0.5, NOW);
    expect(highCitations).toBeGreaterThan(lowCitations);
  });

  it("lets a highly similar but less-cited work outrank a more-cited but barely-similar one", () => {
    // Both similarities are realistic (above MIN_SEMANTIC_SIMILARITY — a work
    // scoring below the floor would be dropped by rankWorksBySimilarity before
    // ever reaching this function, so comparing against a near-zero
    // similarity here wouldn't reflect how this is actually used).
    const relevant = scoreWorkBySimilarity(canonicalWork({ citationCount: 11 }), 0.9, NOW);
    const barelySimilar = scoreWorkBySimilarity(canonicalWork({ citationCount: 200 }), 0.25, NOW);
    expect(relevant).toBeGreaterThan(barelySimilar);
  });
});

describe("rankWorksBySimilarity", () => {
  it("sorts by similarity-based score, highest first", () => {
    const works = [
      canonicalWork({ id: "low-sim" }),
      canonicalWork({ id: "high-sim" }),
      canonicalWork({ id: "mid-sim" }),
    ];
    const similarityByWorkId = new Map([
      ["low-sim", 0.25],
      ["high-sim", 0.9],
      ["mid-sim", 0.5],
    ]);

    const ranked = rankWorksBySimilarity(works, similarityByWorkId, NOW);
    expect(ranked.map((w) => w.id)).toEqual(["high-sim", "mid-sim", "low-sim"]);
  });

  it("drops works below MIN_SEMANTIC_SIMILARITY, regardless of citation count", () => {
    const belowFloor = canonicalWork({ id: "below-floor", citationCount: 999999 });
    const aboveFloor = canonicalWork({ id: "above-floor", citationCount: 1 });
    const similarityByWorkId = new Map([
      ["below-floor", MIN_SEMANTIC_SIMILARITY - 0.01],
      ["above-floor", MIN_SEMANTIC_SIMILARITY + 0.01],
    ]);

    const ranked = rankWorksBySimilarity([belowFloor, aboveFloor], similarityByWorkId, NOW);
    expect(ranked.map((w) => w.id)).toEqual(["above-floor"]);
  });

  it("treats a work missing from the similarity map as similarity 0 (dropped), not a crash", () => {
    const work = canonicalWork({ id: "unmapped" });
    expect(() => rankWorksBySimilarity([work], new Map(), NOW)).not.toThrow();
    expect(rankWorksBySimilarity([work], new Map(), NOW)).toEqual([]);
  });
});
