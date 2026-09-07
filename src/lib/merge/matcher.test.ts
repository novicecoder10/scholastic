import { describe, it, expect } from "vitest";
import type { RawWork } from "@/lib/providers/types";
import { clusterWorks, areFuzzyMatch } from "@/lib/merge/matcher";

function work(overrides: Partial<RawWork>): RawWork {
  return {
    sourceId: "test",
    sourceRecordId: "1",
    doi: null,
    title: "A Paper",
    abstract: null,
    authors: [{ name: "Jane Smith" }],
    year: 2020,
    venue: null,
    citationCount: null,
    isOpenAccess: null,
    pdfUrl: null,
    landingPageUrl: null,
    raw: null,
    ...overrides,
  };
}

describe("clusterWorks", () => {
  it("merges records that share the same DOI, regardless of casing or URL-prefix form", () => {
    const works = [
      work({ sourceId: "openalex", sourceRecordId: "a", doi: "https://doi.org/10.1000/ABC123" }),
      work({ sourceId: "crossref", sourceRecordId: "b", doi: "10.1000/abc123" }),
    ];

    const clusters = clusterWorks(works);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]).toHaveLength(2);
  });

  it("fuzzy-merges a DOI-less preprint with a DOI-bearing published version via title+author+year", () => {
    const works = [
      work({
        sourceId: "arxiv",
        sourceRecordId: "1706.03762",
        doi: null,
        title: "Attention Is All You Need",
        authors: [{ name: "Ashish Vaswani" }],
        year: 2017,
      }),
      work({
        sourceId: "openalex",
        sourceRecordId: "W123",
        doi: "10.1109/xyz.2017",
        title: "Attention is all you need",
        authors: [{ name: "Ashish Vaswani" }],
        year: 2017,
      }),
    ];

    const clusters = clusterWorks(works);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]).toHaveLength(2);
  });

  it("tolerates a one-year drift between preprint and published version", () => {
    const works = [
      work({
        sourceId: "arxiv",
        title: "Some Novel Method For X",
        authors: [{ name: "A Researcher" }],
        year: 2020,
      }),
      work({
        sourceId: "crossref",
        doi: "10.1/x",
        title: "Some Novel Method For X",
        authors: [{ name: "A Researcher" }],
        year: 2021,
      }),
    ];

    expect(clusterWorks(works)).toHaveLength(1);
  });

  it("does NOT merge two distinct papers by the same first author in the same year", () => {
    const works = [
      work({
        sourceId: "a",
        title: "A Study of Protein Folding",
        authors: [{ name: "A Researcher" }],
        year: 2020,
      }),
      work({
        sourceId: "b",
        title: "An Entirely Different Investigation Into Soil Chemistry",
        authors: [{ name: "A Researcher" }],
        year: 2020,
      }),
    ];

    const clusters = clusterWorks(works);
    expect(clusters).toHaveLength(2);
  });

  it("does not merge similar titles by different authors", () => {
    const works = [
      work({ title: "A Study of Protein Folding", authors: [{ name: "Alice Smith" }], year: 2020 }),
      work({ title: "A Study of Protein Folding", authors: [{ name: "Bob Jones" }], year: 2020 }),
    ];

    expect(clusterWorks(works)).toHaveLength(2);
  });

  it("leaves unrelated works in their own singleton clusters", () => {
    const works = [
      work({ sourceId: "a", title: "Topic One", authors: [{ name: "Alice" }], year: 2019 }),
      work({
        sourceId: "b",
        title: "Completely Unrelated Topic",
        authors: [{ name: "Bob" }],
        year: 2022,
      }),
      work({
        sourceId: "c",
        title: "Yet Another Subject",
        authors: [{ name: "Carol" }],
        year: 2015,
      }),
    ];

    expect(clusterWorks(works)).toHaveLength(3);
  });

  it("chains a fuzzy match into an existing DOI-established cluster (3-way merge)", () => {
    const works = [
      work({
        sourceId: "openalex",
        doi: "10.1/abc",
        title: "Deep Learning For Vision",
        authors: [{ name: "Ann Lee" }],
        year: 2019,
      }),
      work({
        sourceId: "crossref",
        doi: "10.1/abc",
        title: "Deep Learning for Vision",
        authors: [{ name: "Ann Lee" }],
        year: 2019,
      }),
      work({
        sourceId: "arxiv",
        doi: null,
        title: "Deep learning for vision",
        authors: [{ name: "Ann Lee" }],
        year: 2019,
      }),
    ];

    const clusters = clusterWorks(works);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]).toHaveLength(3);
  });
});

describe("areFuzzyMatch", () => {
  it("requires the same first-author surname", () => {
    const a = work({ title: "Same Title Here", authors: [{ name: "Alice Smith" }], year: 2020 });
    const b = work({ title: "Same Title Here", authors: [{ name: "Alice Jones" }], year: 2020 });
    expect(areFuzzyMatch(a, b)).toBe(false);
  });

  it("does not block a match when year is missing on one side", () => {
    const a = work({
      title: "A Fairly Specific Title About X",
      authors: [{ name: "Smith" }],
      year: null,
    });
    const b = work({
      title: "A Fairly Specific Title About X",
      authors: [{ name: "Smith" }],
      year: 2020,
    });
    expect(areFuzzyMatch(a, b)).toBe(true);
  });
});
