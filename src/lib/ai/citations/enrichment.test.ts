import { describe, it, expect, vi } from "vitest";
import type { CitationRef } from "@/lib/ai/citations/types";

const getOpenCitationsCitingWorksMock = vi.fn();
const getOpenCitationsReferencesMock = vi.fn();
vi.mock("@/lib/ai/citations/opencitations", () => ({
  getOpenCitationsCitingWorks: (doi: string) => getOpenCitationsCitingWorksMock(doi),
  getOpenCitationsReferences: (doi: string) => getOpenCitationsReferencesMock(doi),
}));

const getSemanticScholarCitingWorksMock = vi.fn();
const getSemanticScholarReferencesMock = vi.fn();
vi.mock("@/lib/providers/semanticscholar/citations", () => ({
  getSemanticScholarCitingWorks: (doi: string) => getSemanticScholarCitingWorksMock(doi),
  getSemanticScholarReferences: (doi: string) => getSemanticScholarReferencesMock(doi),
}));

const { mergeCitationRefs, getCitationEnrichment, getCitationEnrichmentByDoi } =
  await import("@/lib/ai/citations/enrichment");

describe("mergeCitationRefs", () => {
  it("deduplicates by normalized DOI across multiple source lists", () => {
    const openCitations: CitationRef[] = [{ doi: "10.1/a", title: null, year: null }];
    const semanticScholar: CitationRef[] = [{ doi: "10.1/A", title: "Paper A", year: 2020 }];

    const result = mergeCitationRefs([openCitations, semanticScholar]);
    expect(result).toHaveLength(1);
  });

  it("prefers the entry with a title over a bare-DOI duplicate", () => {
    const openCitations: CitationRef[] = [{ doi: "10.1/a", title: null, year: null }];
    const semanticScholar: CitationRef[] = [{ doi: "10.1/a", title: "Paper A", year: 2020 }];

    const result = mergeCitationRefs([openCitations, semanticScholar]);
    expect(result).toEqual([{ doi: "10.1/a", title: "Paper A", year: 2020 }]);
  });

  it("keeps non-duplicate refs from every list", () => {
    const openCitations: CitationRef[] = [{ doi: "10.1/a", title: null, year: null }];
    const semanticScholar: CitationRef[] = [{ doi: "10.1/b", title: "Paper B", year: 2019 }];

    const result = mergeCitationRefs([openCitations, semanticScholar]);
    expect(result).toHaveLength(2);
  });

  it("keeps DOI-less refs (no dedup key available) rather than dropping them", () => {
    const refs: CitationRef[] = [
      { doi: null, title: "Untitled preprint one", year: null },
      { doi: null, title: "Untitled preprint two", year: null },
    ];
    expect(mergeCitationRefs([refs])).toHaveLength(2);
  });

  it("handles an empty input without throwing", () => {
    expect(mergeCitationRefs([])).toEqual([]);
  });
});

describe("getCitationEnrichment", () => {
  it("propagates a database-unavailable failure rather than silently returning empty results", async () => {
    // Unlike the search/embedding caches, this needs the `work` table lookup
    // to even know the work's DOI — there's no fallback data source, so a
    // missing DB (DATABASE_URL is unset in this test environment) surfaces as
    // an error rather than a graceful empty result, same as summary.ts.
    await expect(getCitationEnrichment("doi:somehash")).rejects.toThrow();
  });
});

describe("getCitationEnrichmentByDoi", () => {
  it("works from a bare DOI with no `work`-row dependency (unlike getCitationEnrichment)", async () => {
    getOpenCitationsCitingWorksMock.mockResolvedValue([
      { doi: "10.1/citer-a", title: null, year: null },
    ]);
    getOpenCitationsReferencesMock.mockResolvedValue([]);
    getSemanticScholarCitingWorksMock.mockResolvedValue([]);
    getSemanticScholarReferencesMock.mockResolvedValue([
      { doi: "10.1/ref-a", title: "Ref A", year: 2019 },
    ]);

    // No DATABASE_URL in this test env, and no work-table lookup happens at
    // all here — this must succeed purely from the (mocked) external fetches.
    const result = await getCitationEnrichmentByDoi("10.1/expansion-node");

    expect(result.citing).toEqual([{ doi: "10.1/citer-a", title: null, year: null }]);
    expect(result.cited).toEqual([{ doi: "10.1/ref-a", title: "Ref A", year: 2019 }]);
    expect(result.sources.sort()).toEqual(["opencitations", "semantic_scholar"]);
    expect(result.degraded).toBe(false);
  });

  it("reports degraded:true (not an error) when one source fails", async () => {
    getOpenCitationsCitingWorksMock.mockRejectedValue(new Error("timeout"));
    getOpenCitationsReferencesMock.mockRejectedValue(new Error("timeout"));
    getSemanticScholarCitingWorksMock.mockResolvedValue([]);
    getSemanticScholarReferencesMock.mockResolvedValue([]);

    const result = await getCitationEnrichmentByDoi("10.1/flaky");
    expect(result.sources).toEqual(["semantic_scholar"]);
    expect(result.degraded).toBe(true);
  });
});
