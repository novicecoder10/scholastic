import { describe, it, expect, vi } from "vitest";
import type { CanonicalWork } from "@/lib/types/work";

const embedQueryMock = vi.fn();
vi.mock("@/lib/ai/embeddings", () => ({
  embedQuery: (query: string) => embedQueryMock(query),
}));

const getOrComputeEmbeddingsMock = vi.fn();
vi.mock("@/lib/ai/embeddings/cache", () => ({
  getOrComputeEmbeddings: (items: unknown) => getOrComputeEmbeddingsMock(items),
}));

import { rankBySemanticSimilarity } from "@/lib/ai/semanticRank";

function canonicalWork(overrides: Partial<CanonicalWork> = {}): CanonicalWork {
  return {
    id: "1",
    workKey: "test-key",
    doi: null,
    title: "A Paper",
    abstract: "An abstract.",
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

describe("rankBySemanticSimilarity", () => {
  it("returns an empty array without embedding anything when there are no candidates", async () => {
    const result = await rankBySemanticSimilarity([], "some query");
    expect(result).toEqual([]);
    expect(embedQueryMock).not.toHaveBeenCalled();
  });

  it("ranks candidates by cosine similarity to the query embedding", async () => {
    embedQueryMock.mockResolvedValue([1, 0]);
    const workA = canonicalWork({ id: "work-a", title: "Paper A" });
    const workB = canonicalWork({ id: "work-b", title: "Paper B" });

    getOrComputeEmbeddingsMock.mockImplementation(async (items: { workKey: string }[]) => {
      const map = new Map<string, number[]>();
      // work-a's embedding is parallel to the query (similarity 1.0); work-b's
      // is at similarity 0.6 — both above the floor, so both should survive,
      // with work-a ranked first.
      map.set(items[0].workKey, [1, 0]);
      map.set(items[1].workKey, [0.6, 0.8]);
      return map;
    });

    const ranked = await rankBySemanticSimilarity([workA, workB], "query text");
    expect(ranked.map((w) => w.id)).toEqual(["work-a", "work-b"]);
  });

  it("drops a candidate with no computed embedding available, without crashing", async () => {
    embedQueryMock.mockResolvedValue([1, 0]);
    getOrComputeEmbeddingsMock.mockResolvedValue(new Map());

    const result = await rankBySemanticSimilarity([canonicalWork()], "query text");
    expect(result).toEqual([]);
  });

  it("propagates a query-embedding failure to the caller (search.ts handles the fallback)", async () => {
    embedQueryMock.mockRejectedValue(new Error("embedding backend down"));
    await expect(rankBySemanticSimilarity([canonicalWork()], "query text")).rejects.toThrow(
      "embedding backend down",
    );
  });
});
