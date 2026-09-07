import { describe, it, expect, vi } from "vitest";

const embedQueryMock = vi.fn();
vi.mock("@/lib/ai/embeddings", () => ({
  embedQuery: (query: string) => embedQueryMock(query),
}));

const getOrComputeEmbeddingsMock = vi.fn();
vi.mock("@/lib/ai/embeddings/cache", () => ({
  getOrComputeEmbeddings: (items: unknown) => getOrComputeEmbeddingsMock(items),
}));

import { buildSynthesisContext } from "@/lib/ai/synthesisContext";

describe("buildSynthesisContext", () => {
  it("returns an empty string for no works, without embedding anything", async () => {
    const result = await buildSynthesisContext("some question", []);
    expect(result).toBe("");
    expect(embedQueryMock).not.toHaveBeenCalled();
  });

  it("ranks works by similarity to the query and formats the top results as titled context blocks", async () => {
    embedQueryMock.mockResolvedValue([1, 0]);
    getOrComputeEmbeddingsMock.mockImplementation(async (items: { workKey: string }[]) => {
      const map = new Map<string, number[]>();
      map.set(items[0].workKey, [0.1, 0.99]); // low similarity
      map.set(items[1].workKey, [1, 0]); // high similarity (parallel to query)
      return map;
    });

    const works = [
      { workKey: "a", title: "Less Relevant Paper", abstract: "About something else." },
      { workKey: "b", title: "Highly Relevant Paper", abstract: "Directly on topic." },
    ];

    const result = await buildSynthesisContext("question", works);
    const paper1Index = result.indexOf("Paper 1:");
    const highlyRelevantIndex = result.indexOf("Highly Relevant Paper");
    const lessRelevantIndex = result.indexOf("Less Relevant Paper");

    expect(paper1Index).toBeGreaterThanOrEqual(0);
    expect(highlyRelevantIndex).toBeLessThan(lessRelevantIndex);
    expect(result).toContain("Directly on topic.");
  });

  it("caps context at the top 8 most-similar works", async () => {
    embedQueryMock.mockResolvedValue([1]);
    getOrComputeEmbeddingsMock.mockImplementation(async (items: { workKey: string }[]) => {
      const map = new Map<string, number[]>();
      items.forEach((item, i) => map.set(item.workKey, [i]));
      return map;
    });

    const works = Array.from({ length: 12 }, (_, i) => ({
      workKey: `work-${i}`,
      title: `Paper ${i}`,
      abstract: "abstract",
    }));

    const result = await buildSynthesisContext("question", works);
    expect(result.match(/^Paper \d+:/gm)).toHaveLength(8);
  });

  it("handles a work with no computed embedding by excluding it rather than crashing", async () => {
    embedQueryMock.mockResolvedValue([1, 0]);
    getOrComputeEmbeddingsMock.mockResolvedValue(new Map()); // no embeddings computed at all

    const works = [{ workKey: "a", title: "Some Paper", abstract: "abstract" }];
    await expect(buildSynthesisContext("question", works)).resolves.toBe("");
  });

  it("notes when a work has no abstract available, rather than omitting it silently", async () => {
    embedQueryMock.mockResolvedValue([1]);
    getOrComputeEmbeddingsMock.mockResolvedValue(new Map([["a", [1]]]));

    const result = await buildSynthesisContext("question", [
      { workKey: "a", title: "No Abstract Paper", abstract: null },
    ]);
    expect(result).toContain("no abstract available");
  });
});
