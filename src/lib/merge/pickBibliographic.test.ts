import { describe, it, expect } from "vitest";
import { pickBibliographic, pickTopics } from "@/lib/merge/reconcile";
import type { BibliographicDetail, RawWork } from "@/lib/providers/types";

function detail(overrides: Partial<BibliographicDetail> = {}): BibliographicDetail {
  return {
    volume: "1",
    issue: null,
    firstPage: null,
    lastPage: null,
    publisher: null,
    containerTitle: null,
    type: null,
    issued: null,
    issn: null,
    isbn: null,
    ...overrides,
  };
}

function raw(sourceId: string, overrides: Partial<RawWork> = {}): RawWork {
  return {
    sourceId,
    sourceRecordId: `${sourceId}-1`,
    doi: null,
    title: "T",
    abstract: null,
    authors: [],
    year: null,
    venue: null,
    citationCount: null,
    isOpenAccess: null,
    pdfUrl: null,
    landingPageUrl: null,
    raw: {},
    ...overrides,
  };
}

describe("pickBibliographic", () => {
  it("returns null when no source in the cluster carries a block", () => {
    expect(pickBibliographic([raw("arxiv"), raw("core")])).toBeNull();
  });

  it("takes the block from the single highest-priority source", () => {
    // Crossref outranks OpenAlex in PUBLISHED_SOURCE_PRIORITY.
    const picked = pickBibliographic([
      raw("openalex", { bibliographic: detail({ volume: "999" }) }),
      raw("crossref", { bibliographic: detail({ volume: "218" }) }),
    ]);
    expect(picked?.volume).toBe("218");
  });

  it("never merges fields across sources", () => {
    // The whole point: a volume from one source and a page range from another
    // reads as authoritative and can be wrong undetectably.
    const picked = pickBibliographic([
      raw("crossref", { bibliographic: detail({ volume: "218", firstPage: null }) }),
      raw("pubmed", { bibliographic: detail({ volume: "999", firstPage: "125" }) }),
    ]);
    expect(picked?.volume).toBe("218");
    expect(picked?.firstPage).toBeNull();
  });

  it("skips a block whose every field is null", () => {
    const empty = detail({ volume: null });
    const picked = pickBibliographic([
      raw("crossref", { bibliographic: empty }),
      raw("pubmed", { bibliographic: detail({ volume: "12" }) }),
    ]);
    expect(picked?.volume).toBe("12");
  });

  it("falls back to an unranked source when no priority source has one", () => {
    const picked = pickBibliographic([raw("arxiv"), raw("core", { bibliographic: detail() })]);
    expect(picked?.volume).toBe("1");
  });

  it("is stable regardless of cluster ordering", () => {
    const a = raw("openalex", { bibliographic: detail({ volume: "999" }) });
    const b = raw("crossref", { bibliographic: detail({ volume: "218" }) });
    expect(pickBibliographic([a, b])).toEqual(pickBibliographic([b, a]));
  });
});

describe("pickTopics", () => {
  it("is empty when no source supplied topics", () => {
    expect(pickTopics([raw("crossref")])).toEqual([]);
  });

  it("dedupes by name, keeping the highest score, ranked", () => {
    const picked = pickTopics([
      raw("openalex", {
        topics: [
          { name: "Genomics", score: 0.4 },
          { name: "Oncology", score: 0.9 },
        ],
      }),
      raw("openalex", { sourceRecordId: "x", topics: [{ name: "Genomics", score: 0.7 }] }),
    ]);
    expect(picked).toEqual([
      { name: "Oncology", score: 0.9 },
      { name: "Genomics", score: 0.7 },
    ]);
  });
});
