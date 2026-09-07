import { describe, it, expect } from "vitest";
import { mapCrossrefItem } from "@/lib/providers/crossref/mapper";
import { mapOpenAlexWork } from "@/lib/providers/openalex/mapper";
import { mapEuropePmcResult } from "@/lib/providers/europepmc/mapper";
import { mapPubmedArticle } from "@/lib/providers/pubmed/mapper";
import { mapArxivEntry } from "@/lib/providers/arxiv/mapper";

/**
 * `bibliographic` is additive and optional, so the risk is not that these
 * mappers crash — it's that they quietly produce nothing, and the citation
 * generator then reports every record incomplete. These assert the fields
 * actually arrive.
 */
describe("bibliographic detail extraction", () => {
  it("Crossref: splits the page string and keeps the full issued date", () => {
    const work = mapCrossrefItem({
      DOI: "10.1000/xyz",
      title: ["A Paper"],
      volume: "218",
      issue: "3",
      page: "125-134",
      publisher: "Rockefeller University Press",
      "container-title": ["Journal of Cell Biology"],
      type: "journal-article",
      published: { "date-parts": [[2019, 3, 4]] },
      ISSN: ["0021-9525"],
    });
    expect(work.bibliographic).toEqual({
      volume: "218",
      issue: "3",
      firstPage: "125",
      lastPage: "134",
      publisher: "Rockefeller University Press",
      containerTitle: "Journal of Cell Biology",
      type: "journal-article",
      issued: { year: 2019, month: 3, day: 4 },
      issn: "0021-9525",
      isbn: null,
    });
  });

  it("Crossref: an article-number page (no range) has no last page", () => {
    const work = mapCrossrefItem({ DOI: "d", page: "e0123456" });
    expect(work.bibliographic?.firstPage).toBe("e0123456");
    expect(work.bibliographic?.lastPage).toBeNull();
  });

  it("Crossref: a record with no bibliographic fields yields an all-null block", () => {
    const detail = mapCrossrefItem({ DOI: "d" }).bibliographic!;
    expect(Object.values(detail).every((v) => v === null)).toBe(true);
  });

  it("OpenAlex: reads biblio, type and the full publication date", () => {
    const work = mapOpenAlexWork({
      id: "W1",
      biblio: { volume: "12", issue: "4", first_page: "1", last_page: "9" },
      type: "journal-article",
      publication_date: "2020-06-15",
      publication_year: 2020,
      primary_location: {
        source: { display_name: "Nature", host_organization_name: "Springer", issn_l: "0028-0836" },
      },
    });
    expect(work.bibliographic).toMatchObject({
      volume: "12",
      firstPage: "1",
      lastPage: "9",
      containerTitle: "Nature",
      publisher: "Springer",
      issn: "0028-0836",
      issued: { year: 2020, month: 6, day: 15 },
    });
  });

  it("OpenAlex: falls back to publication_year when there is no full date", () => {
    const work = mapOpenAlexWork({ id: "W1", publication_year: 1998 });
    expect(work.bibliographic?.issued).toEqual({ year: 1998 });
  });

  it("OpenAlex: maps concepts to topics, dropping unnamed ones", () => {
    const work = mapOpenAlexWork({
      id: "W1",
      concepts: [{ display_name: "Genomics", score: 0.82 }, { display_name: "Oncology" }],
    });
    expect(work.topics).toEqual([
      { name: "Genomics", score: 0.82 },
      { name: "Oncology", score: 0 },
    ]);
  });

  it("OpenAlex: leaves topics undefined when the payload has no concepts", () => {
    expect(mapOpenAlexWork({ id: "W1" }).topics).toBeUndefined();
  });

  it("Europe PMC: parses pageInfo and takes the first pubType", () => {
    const work = mapEuropePmcResult({
      id: "1",
      title: "T",
      journalVolume: "7",
      issue: "2",
      pageInfo: "45-52",
      journalTitle: "Gut",
      pubType: "research-article, Journal Article",
      firstPublicationDate: "2015-11-02",
      pubYear: "2015",
    });
    expect(work.bibliographic).toMatchObject({
      volume: "7",
      firstPage: "45",
      lastPage: "52",
      type: "research-article",
      issued: { year: 2015, month: 11, day: 2 },
    });
  });

  it("PubMed: trusts only the year from its free-text pubdate", () => {
    // "2019 Spring" and "2019 Mar 14" both appear in real esummary payloads.
    const work = mapPubmedArticle(
      { uid: "1", title: "T", pubdate: "2019 Spring", volume: "5", pages: "10-20" },
      null,
    );
    expect(work.bibliographic?.issued).toEqual({ year: 2019 });
    expect(work.bibliographic?.firstPage).toBe("10");
  });

  it("adapters that were not changed still produce no bibliographic block", () => {
    // The spec kept arXiv, DOAJ, CORE, Unpaywall and Semantic Scholar
    // untouched; `pickBibliographic` treats an absent block as "no data",
    // which is the correct outcome rather than a gap to paper over.
    const work = mapArxivEntry({
      id: "http://arxiv.org/abs/2401.00001v1",
      title: "T",
      summary: "s",
      published: "2024-01-01T00:00:00Z",
    });
    expect(work.bibliographic).toBeUndefined();
  });
});
