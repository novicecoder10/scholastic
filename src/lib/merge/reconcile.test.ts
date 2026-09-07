import { describe, it, expect } from "vitest";
import type { RawWork } from "@/lib/providers/types";
import { reconcileCluster } from "@/lib/merge/reconcile";

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

describe("reconcileCluster", () => {
  it("prefers a published source's title over an arXiv preprint's", () => {
    const result = reconcileCluster([
      work({ sourceId: "arxiv", title: "attention is all you need (v3, latex fix)" }),
      work({ sourceId: "openalex", title: "Attention Is All You Need" }),
    ]);
    expect(result.title).toBe("Attention Is All You Need");
  });

  it("prefers Crossref's DOI when sources disagree", () => {
    const result = reconcileCluster([
      work({ sourceId: "openalex", doi: "10.1/wrong" }),
      work({ sourceId: "crossref", doi: "10.1/correct" }),
    ]);
    expect(result.doi).toBe("10.1/correct");
  });

  it("takes the maximum citation count across sources", () => {
    const result = reconcileCluster([
      work({ sourceId: "openalex", citationCount: 50 }),
      work({ sourceId: "crossref", citationCount: 120 }),
      work({ sourceId: "arxiv", citationCount: null }),
    ]);
    expect(result.citationCount).toBe(120);
  });

  it("marks open access true if any contributing source reports it", () => {
    const result = reconcileCluster([
      work({ sourceId: "crossref", isOpenAccess: null, pdfUrl: null }),
      work({ sourceId: "openalex", isOpenAccess: true, pdfUrl: "https://example.org/oa.pdf" }),
    ]);
    expect(result.isOpenAccess).toBe(true);
    expect(result.pdfUrl).toBe("https://example.org/oa.pdf");
  });

  it("prefers Unpaywall's pdf link when multiple sources have one", () => {
    const result = reconcileCluster([
      work({ sourceId: "openalex", isOpenAccess: true, pdfUrl: "https://openalex.example/oa.pdf" }),
      work({
        sourceId: "unpaywall",
        isOpenAccess: true,
        pdfUrl: "https://unpaywall.example/oa.pdf",
      }),
    ]);
    expect(result.pdfUrl).toBe("https://unpaywall.example/oa.pdf");
  });

  it("takes the author list from the source with the most ORCIDs", () => {
    const result = reconcileCluster([
      work({ sourceId: "arxiv", authors: [{ name: "Ann Lee" }, { name: "Bo Chen" }] }),
      work({
        sourceId: "openalex",
        authors: [
          { name: "Ann Lee", orcid: "0000-0001-1111-1111" },
          { name: "Bo Chen", orcid: "0000-0002-2222-2222" },
        ],
      }),
    ]);
    expect(result.authors.every((a) => a.orcid)).toBe(true);
  });

  it("takes the modal year, breaking ties toward the published source", () => {
    const result = reconcileCluster([
      work({ sourceId: "arxiv", year: 2020 }),
      work({ sourceId: "crossref", year: 2021 }),
    ]);
    expect(result.year).toBe(2021);
  });

  it("records every contributing source with its own citation count", () => {
    const result = reconcileCluster([
      work({ sourceId: "openalex", sourceRecordId: "W1", citationCount: 10 }),
      work({ sourceId: "crossref", sourceRecordId: "10.1/x", citationCount: 12 }),
    ]);
    expect(result.sources).toEqual([
      { sourceId: "openalex", sourceRecordId: "W1", citationCount: 10 },
      { sourceId: "crossref", sourceRecordId: "10.1/x", citationCount: 12 },
    ]);
  });

  it("derives a stable id from the DOI when present, else from the first source ref", () => {
    const withDoi = reconcileCluster([work({ doi: "10.1/abc" })]);
    expect(withDoi.id).toBe("doi:10.1/abc");

    const withoutDoi = reconcileCluster([work({ sourceId: "arxiv", sourceRecordId: "1234.5678" })]);
    expect(withoutDoi.id).toBe("arxiv:1234.5678");
  });

  it("defaults score to 0, leaving ranking to a later pass", () => {
    const result = reconcileCluster([work({})]);
    expect(result.score).toBe(0);
  });

  it("computes a workKey stable across separate reconciliations of the same DOI", () => {
    const a = reconcileCluster([work({ doi: "10.1/abc" })]);
    const b = reconcileCluster([work({ doi: "10.1/ABC" })]); // case drift, same DOI
    expect(a.workKey).toBe(b.workKey);
    expect(a.workKey).toMatch(/^doi:[0-9a-f]{64}$/);
  });

  it("computes a different workKey (from `id`, which is not necessarily hashed) for DOI-less works, still stable and content-derived", () => {
    const result = reconcileCluster([work({ doi: null, title: "A Unique Title", year: 2021 })]);
    expect(result.workKey).toMatch(/^hash:[0-9a-f]{64}$/);
    // workKey (cross-request stable, content-hashed) is intentionally a
    // different scheme from id (response-scoped, doi-or-sourceRef based).
    expect(result.workKey).not.toBe(result.id);
  });
});
