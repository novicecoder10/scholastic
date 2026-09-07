import type { RawWork, RawWorkAuthor } from "@/lib/providers/types";

export interface ArxivLink {
  "@_href": string;
  "@_rel"?: string;
  "@_type"?: string;
  "@_title"?: string;
}

export interface ArxivAuthor {
  name: string;
}

/**
 * Atom permits any element to repeat, and the XML parser collapses a repeated
 * element into an array — so every field here that looks like a single string
 * can arrive as `string[]`. arXiv really does serve such records: one result
 * for "sleep deprivation" carries four identical `<arxiv:doi>` elements, which
 * reached `normalizeDoi` as an array and took down the whole nine-provider
 * search with `doi.trim is not a function`.
 */
export interface ArxivEntry {
  id: string;
  title: string | string[];
  summary?: string | string[];
  published?: string;
  updated?: string;
  author?: ArxivAuthor[];
  link?: ArxivLink[];
  "arxiv:doi"?: string | string[];
}

export interface ArxivFeed {
  feed: {
    "opensearch:totalResults"?: number;
    entry?: ArxivEntry[];
  };
}

/** The first value of a field the parser may have collapsed into an array.
 * Repeats in these records are duplicates rather than alternatives, so the
 * first is the value; taking it is what keeps one malformed entry from
 * reaching the merge layer as the wrong type. */
function firstString(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    const found = value.find((v) => typeof v === "string" && v.trim() !== "");
    return found ?? null;
  }
  return typeof value === "string" ? value : null;
}

function extractArxivId(id: string): string {
  // e.g. "http://arxiv.org/abs/1706.03762v5" -> "1706.03762v5"
  const match = id.match(/abs\/(.+)$/);
  return match ? match[1] : id;
}

function extractYear(dateStr: string | undefined): number | null {
  if (!dateStr) return null;
  const year = new Date(dateStr).getFullYear();
  return Number.isNaN(year) ? null : year;
}

function findLink(
  links: ArxivLink[] | undefined,
  predicate: (l: ArxivLink) => boolean,
): string | null {
  return links?.find(predicate)?.["@_href"] ?? null;
}

export function mapArxivEntry(entry: ArxivEntry): RawWork {
  const authors: RawWorkAuthor[] = (entry.author ?? []).map((a) => ({ name: a.name }));
  const links = entry.link ?? [];
  const title = firstString(entry.title) ?? "";
  const summary = firstString(entry.summary);

  const pdfUrl = findLink(
    links,
    (l) => l["@_title"] === "pdf" || l["@_type"] === "application/pdf",
  );
  const landingPageUrl = findLink(links, (l) => l["@_rel"] === "alternate") ?? entry.id;

  return {
    sourceId: "arxiv",
    sourceRecordId: extractArxivId(entry.id),
    // arxiv:doi is only present once a preprint has been formally published elsewhere.
    doi: firstString(entry["arxiv:doi"]),
    title: title.replace(/\s+/g, " ").trim(),
    abstract: summary ? summary.replace(/\s+/g, " ").trim() : null,
    authors,
    year: extractYear(entry.published),
    venue: "arXiv",
    citationCount: null,
    // Every arXiv preprint is, by construction, freely readable.
    isOpenAccess: true,
    pdfUrl,
    landingPageUrl,
    raw: entry,
  };
}
