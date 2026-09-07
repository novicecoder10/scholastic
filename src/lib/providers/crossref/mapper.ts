import type { BibliographicDetail, RawWork, RawWorkAuthor } from "@/lib/providers/types";

export interface CrossrefAuthor {
  given?: string;
  family?: string;
  ORCID?: string;
}

export interface CrossrefLink {
  URL: string;
  "content-type"?: string;
  "intended-application"?: string;
}

export interface CrossrefItem {
  DOI: string;
  title?: string[];
  author?: CrossrefAuthor[];
  published?: { "date-parts"?: number[][] };
  "container-title"?: string[];
  "is-referenced-by-count"?: number;
  abstract?: string;
  link?: CrossrefLink[];
  URL?: string;
  volume?: string;
  issue?: string;
  page?: string;
  publisher?: string;
  type?: string;
  ISSN?: string[];
  ISBN?: string[];
}

export interface CrossrefResponse {
  message: {
    "total-results": number;
    items: CrossrefItem[];
  };
}

function stripJatsTags(text: string | undefined | null): string | null {
  if (!text) return null;
  const stripped = text.replace(/<\/?jats:[^>]+>/g, "").trim();
  return stripped.length > 0 ? stripped : null;
}

function normalizeOrcid(orcid: string | null | undefined): string | undefined {
  if (!orcid) return undefined;
  return orcid.replace(/^https?:\/\/orcid\.org\//, "");
}

function findPdfUrl(links: CrossrefLink[] | undefined): string | null {
  if (!links) return null;
  const pdfLink = links.find(
    (l) =>
      l["content-type"] === "application/pdf" &&
      l["intended-application"] !== "similarity-checking",
  );
  return pdfLink?.URL ?? null;
}

/** Crossref states pages as a single "125-134" (or "e0123456") string. */
function splitPages(page: string | undefined): {
  firstPage: string | null;
  lastPage: string | null;
} {
  if (!page) return { firstPage: null, lastPage: null };
  const [first, last] = page.split(/[-–]/, 2);
  return { firstPage: first?.trim() || null, lastPage: last?.trim() ?? null };
}

function crossrefBibliographic(item: CrossrefItem): BibliographicDetail {
  const parts = item.published?.["date-parts"]?.[0];
  const { firstPage, lastPage } = splitPages(item.page);
  return {
    volume: item.volume ?? null,
    issue: item.issue ?? null,
    firstPage,
    lastPage,
    publisher: item.publisher ?? null,
    containerTitle: item["container-title"]?.[0] ?? null,
    type: item.type ?? null,
    issued: parts?.[0] ? { year: parts[0], month: parts[1], day: parts[2] } : null,
    issn: item.ISSN?.[0] ?? null,
    isbn: item.ISBN?.[0] ?? null,
  };
}

export function mapCrossrefItem(item: CrossrefItem): RawWork {
  const authors: RawWorkAuthor[] = (item.author ?? []).map((a) => ({
    name: [a.given, a.family].filter(Boolean).join(" ") || "Unknown Author",
    orcid: normalizeOrcid(a.ORCID),
  }));

  return {
    sourceId: "crossref",
    sourceRecordId: item.DOI,
    doi: item.DOI,
    title: item.title?.[0] ?? "Untitled",
    abstract: stripJatsTags(item.abstract),
    authors,
    year: item.published?.["date-parts"]?.[0]?.[0] ?? null,
    venue: item["container-title"]?.[0] ?? null,
    citationCount: item["is-referenced-by-count"] ?? null,
    // Crossref doesn't reliably expose an OA signal; Unpaywall is the authoritative
    // source for that. Leave null here rather than guessing.
    isOpenAccess: null,
    pdfUrl: findPdfUrl(item.link),
    landingPageUrl: item.URL ?? `https://doi.org/${item.DOI}`,
    bibliographic: crossrefBibliographic(item),
    raw: item,
  };
}
