import type { BibliographicDetail } from "@/lib/providers/types";
import type { CanonicalWork } from "@/lib/types/work";

/** Shared across the citation tests. Exported from src rather than a test file
 * so the formatters' fixtures stay in one place as styles are added. */
export function work(overrides: Partial<CanonicalWork> = {}): CanonicalWork {
  return {
    id: "doi:10.1000/xyz",
    workKey: "doi:10.1000/xyz",
    doi: "10.1000/xyz",
    title: "Mitochondrial Dysfunction in Model Systems",
    abstract: null,
    authors: [{ name: "Jane Smith" }],
    year: 2019,
    venue: "Journal of Cell Biology",
    citationCount: 12,
    isOpenAccess: true,
    pdfUrl: null,
    landingPageUrl: "https://doi.org/10.1000/xyz",
    sources: [],
    bibliographic: bibliographic(),
    topics: [],
    score: 0,
    ...overrides,
  };
}

export function bibliographic(overrides: Partial<BibliographicDetail> = {}): BibliographicDetail {
  return {
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
    ...overrides,
  };
}
