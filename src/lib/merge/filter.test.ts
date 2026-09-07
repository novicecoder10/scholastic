import { describe, it, expect } from "vitest";
import type { CanonicalWork } from "@/lib/types/work";
import { filterWorks } from "@/lib/merge/filter";

function work(overrides: Partial<CanonicalWork>): CanonicalWork {
  return {
    id: "1",
    workKey: "test-key",
    doi: null,
    title: "A Paper",
    abstract: null,
    authors: [],
    year: 2020,
    venue: null,
    citationCount: 10,
    isOpenAccess: false,
    pdfUrl: null,
    landingPageUrl: null,
    sources: [{ sourceId: "openalex", sourceRecordId: "1", citationCount: 10 }],
    bibliographic: null,
    topics: [],
    score: 0,
    ...overrides,
  };
}

describe("filterWorks", () => {
  it("returns everything when no filters are set", () => {
    const works = [work({ id: "a" }), work({ id: "b" })];
    expect(filterWorks(works, {})).toHaveLength(2);
  });

  it("filters by yearFrom/yearTo inclusively", () => {
    const works = [
      work({ id: "old", year: 2010 }),
      work({ id: "mid", year: 2020 }),
      work({ id: "new", year: 2024 }),
    ];
    const result = filterWorks(works, { yearFrom: 2015, yearTo: 2022 });
    expect(result.map((w) => w.id)).toEqual(["mid"]);
  });

  it("excludes works with a missing year when a year filter is set", () => {
    const works = [work({ id: "unknown", year: null }), work({ id: "known", year: 2020 })];
    expect(filterWorks(works, { yearFrom: 2015 }).map((w) => w.id)).toEqual(["known"]);
  });

  it("filters open-access-only", () => {
    const works = [
      work({ id: "closed", isOpenAccess: false }),
      work({ id: "open", isOpenAccess: true }),
    ];
    expect(filterWorks(works, { openAccessOnly: true }).map((w) => w.id)).toEqual(["open"]);
  });

  it("filters by minimum citation count, treating null as 0", () => {
    const works = [
      work({ id: "none", citationCount: null }),
      work({ id: "few", citationCount: 5 }),
      work({ id: "many", citationCount: 500 }),
    ];
    expect(filterWorks(works, { minCitations: 100 }).map((w) => w.id)).toEqual(["many"]);
  });

  it("filters by source membership", () => {
    const works = [
      work({
        id: "a",
        sources: [{ sourceId: "openalex", sourceRecordId: "1", citationCount: null }],
      }),
      work({ id: "b", sources: [{ sourceId: "arxiv", sourceRecordId: "1", citationCount: null }] }),
    ];
    expect(filterWorks(works, { sources: ["arxiv"] }).map((w) => w.id)).toEqual(["b"]);
  });

  it("matches if any of a work's multiple sources is in the requested set", () => {
    const works = [
      work({
        id: "a",
        sources: [
          { sourceId: "openalex", sourceRecordId: "1", citationCount: null },
          { sourceId: "arxiv", sourceRecordId: "1", citationCount: null },
        ],
      }),
    ];
    expect(filterWorks(works, { sources: ["arxiv"] })).toHaveLength(1);
  });

  it("filters by venue membership", () => {
    const works = [
      work({ id: "a", venue: "Nature" }),
      work({ id: "b", venue: "Science" }),
      work({ id: "c", venue: null }),
    ];
    expect(filterWorks(works, { venues: ["Nature"] }).map((w) => w.id)).toEqual(["a"]);
  });

  it("excludes works with a missing venue when a venue filter is set", () => {
    const works = [work({ id: "known", venue: "Nature" }), work({ id: "unknown", venue: null })];
    expect(filterWorks(works, { venues: ["Nature"] }).map((w) => w.id)).toEqual(["known"]);
  });

  it("combines multiple filters with AND semantics", () => {
    const works = [
      work({ id: "match", year: 2021, isOpenAccess: true, citationCount: 50 }),
      work({ id: "wrong-year", year: 2010, isOpenAccess: true, citationCount: 50 }),
      work({ id: "not-oa", year: 2021, isOpenAccess: false, citationCount: 50 }),
    ];
    const result = filterWorks(works, { yearFrom: 2015, openAccessOnly: true, minCitations: 10 });
    expect(result.map((w) => w.id)).toEqual(["match"]);
  });
});
