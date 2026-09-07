import type { BibliographicDetail, RawWork, RawWorkAuthor } from "@/lib/providers/types";

export interface EuropePmcFullTextUrl {
  url: string;
  documentStyle?: string;
  availability?: string;
}

export interface EuropePmcResult {
  id: string;
  pmid?: string;
  doi?: string;
  title: string;
  authorString?: string;
  journalTitle?: string;
  pubYear?: string;
  citedByCount?: number;
  isOpenAccess?: "Y" | "N";
  abstractText?: string;
  fullTextUrlList?: { fullTextUrl?: EuropePmcFullTextUrl[] };
  journalVolume?: string;
  issue?: string;
  pageInfo?: string;
  journalIssn?: string;
  pubType?: string;
  firstPublicationDate?: string;
}

export interface EuropePmcResponse {
  hitCount: number;
  resultList: { result: EuropePmcResult[] };
}

/** Europe PMC returns authors as one combined "Smith J, Doe A." string, not a structured list. */
function parseAuthorString(authorString: string | undefined): RawWorkAuthor[] {
  if (!authorString) return [];
  return authorString
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean)
    .map((name) => ({ name }));
}

function findPdfUrl(urlList: EuropePmcResult["fullTextUrlList"]): string | null {
  const urls = urlList?.fullTextUrl ?? [];
  const openPdf = urls.find((u) => u.availability === "Open access" && u.documentStyle === "pdf");
  return openPdf?.url ?? urls.find((u) => u.documentStyle === "pdf")?.url ?? null;
}

function europePmcBibliographic(result: EuropePmcResult): BibliographicDetail {
  const [first, last] = (result.pageInfo ?? "").split(/[-–]/, 2);
  const [year, month, day] = (result.firstPublicationDate ?? "").split("-").map(Number);
  const pubYear = year || (result.pubYear ? Number.parseInt(result.pubYear, 10) : NaN);

  return {
    volume: result.journalVolume ?? null,
    issue: result.issue ?? null,
    firstPage: first?.trim() || null,
    lastPage: last?.trim() ?? null,
    publisher: null,
    containerTitle: result.journalTitle ?? null,
    // pubType arrives as a comma-separated list; the first entry is the primary.
    type: result.pubType?.split(",")[0]?.trim() || null,
    issued: Number.isFinite(pubYear)
      ? { year: pubYear, month: month || undefined, day: day || undefined }
      : null,
    issn: result.journalIssn ?? null,
    isbn: null,
  };
}

export function mapEuropePmcResult(result: EuropePmcResult): RawWork {
  return {
    sourceId: "europepmc",
    sourceRecordId: result.id,
    doi: result.doi ?? null,
    title: result.title,
    abstract: result.abstractText ?? null,
    authors: parseAuthorString(result.authorString),
    year: result.pubYear ? Number.parseInt(result.pubYear, 10) : null,
    venue: result.journalTitle ?? null,
    citationCount: result.citedByCount ?? null,
    isOpenAccess: result.isOpenAccess === "Y",
    pdfUrl: findPdfUrl(result.fullTextUrlList),
    landingPageUrl: result.doi
      ? `https://doi.org/${result.doi}`
      : `https://europepmc.org/article/MED/${result.pmid ?? result.id}`,
    bibliographic: europePmcBibliographic(result),
    raw: result,
  };
}
