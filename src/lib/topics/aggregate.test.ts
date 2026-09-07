import { describe, it, expect } from "vitest";
import { aggregateTopics, dropUniversalTopics, MAX_CANDIDATES } from "@/lib/topics/aggregate";
import type { CanonicalWork } from "@/lib/types/work";

function work(workKey: string, topics: Array<[string, number]>): CanonicalWork {
  return {
    id: workKey,
    workKey,
    doi: null,
    title: "T",
    abstract: null,
    authors: [],
    year: null,
    venue: null,
    citationCount: null,
    isOpenAccess: false,
    pdfUrl: null,
    landingPageUrl: null,
    sources: [],
    bibliographic: null,
    topics: topics.map(([name, score]) => ({ name, score })),
    score: 0,
  };
}

describe("aggregateTopics", () => {
  it("returns nothing for an empty result set", () => {
    expect(aggregateTopics([])).toEqual([]);
  });

  it("returns nothing when no result carries topics", () => {
    expect(aggregateTopics([work("a", [])])).toEqual([]);
  });

  it("counts a concept once per work and sums its confidence", () => {
    const [top] = aggregateTopics([work("a", [["Genomics", 0.8]]), work("b", [["Genomics", 0.6]])]);
    expect(top).toMatchObject({ name: "Genomics", count: 2, workKeys: ["a", "b"] });
    expect(top.weight).toBeCloseTo(1.4);
  });

  it("ranks a few strong signals above many weak mentions", () => {
    const ranked = aggregateTopics([
      work("a", [["Deep", 0.95]]),
      work("b", [["Deep", 0.95]]),
      work("c", [["Passing", 0.3]]),
      work("d", [["Passing", 0.3]]),
      work("e", [["Passing", 0.3]]),
    ]);
    expect(ranked[0].name).toBe("Deep");
  });

  it("drops concepts the source itself is unsure about", () => {
    expect(aggregateTopics([work("a", [["Noise", 0.05]])])).toEqual([]);
  });

  it("breaks ties on name so the panel does not reshuffle between renders", () => {
    const input = [
      work("a", [
        ["Beta", 0.5],
        ["Alpha", 0.5],
      ]),
    ];
    expect(aggregateTopics(input).map((t) => t.name)).toEqual(["Alpha", "Beta"]);
  });

  it("caps the candidate list", () => {
    const many = work(
      "a",
      Array.from({ length: MAX_CANDIDATES + 20 }, (_, i) => [`C${i}`, 0.9] as [string, number]),
    );
    expect(aggregateTopics([many])).toHaveLength(MAX_CANDIDATES);
  });

  it("ignores results with no topics field at all", () => {
    const bare = { ...work("a", []), topics: [] };
    expect(aggregateTopics([bare, work("b", [["X", 0.9]])]).map((t) => t.name)).toEqual(["X"]);
  });
});

describe("dropUniversalTopics", () => {
  it("removes a concept every work carries", () => {
    const works = Array.from({ length: 6 }, (_, i) =>
      work(String(i), [
        ["Everywhere", 0.9],
        ["Sometimes", 0.9],
      ]),
    );
    works[0].topics = [{ name: "Everywhere", score: 0.9 }];
    const aggregated = aggregateTopics(works);
    const kept = dropUniversalTopics(aggregated, works.length).map((t) => t.name);
    expect(kept).toContain("Sometimes");
    expect(kept).not.toContain("Everywhere");
  });

  it("keeps everything for a small set, where 'every work' means nothing", () => {
    const works = [work("a", [["X", 0.9]]), work("b", [["X", 0.9]])];
    expect(dropUniversalTopics(aggregateTopics(works), works.length)).toHaveLength(1);
  });
});
