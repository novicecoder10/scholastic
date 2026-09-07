import type {
  BibliographicDetail,
  RawWork,
  RawWorkAuthor,
  RawWorkTopic,
} from "@/lib/providers/types";

export interface OpenAlexAuthorship {
  author: {
    display_name: string;
    orcid?: string | null;
  };
}

export interface OpenAlexBiblio {
  volume?: string | null;
  issue?: string | null;
  first_page?: string | null;
  last_page?: string | null;
}

export interface OpenAlexConcept {
  display_name: string;
  score?: number | null;
}

export interface OpenAlexLocation {
  landing_page_url?: string | null;
  pdf_url?: string | null;
  is_oa?: boolean | null;
  source?: {
    display_name?: string | null;
    host_organization_name?: string | null;
    issn_l?: string | null;
  } | null;
}

export interface OpenAlexWork {
  id: string;
  doi?: string | null;
  title?: string | null;
  display_name?: string | null;
  publication_year?: number | null;
  primary_location?: OpenAlexLocation | null;
  open_access?: {
    is_oa?: boolean | null;
    oa_url?: string | null;
  } | null;
  authorships?: OpenAlexAuthorship[];
  cited_by_count?: number | null;
  abstract_inverted_index?: Record<string, number[]> | null;
  biblio?: OpenAlexBiblio | null;
  type?: string | null;
  publication_date?: string | null;
  concepts?: OpenAlexConcept[] | null;
}

export interface OpenAlexResponse {
  meta: { count: number };
  results: OpenAlexWork[];
}

/** OpenAlex returns abstracts as a word -> position[] inverted index instead of plain text. */
export function reconstructAbstract(
  index: Record<string, number[]> | null | undefined,
): string | null {
  if (!index) return null;
  const positions: [number, string][] = [];
  for (const [word, occurrences] of Object.entries(index)) {
    for (const pos of occurrences) {
      positions.push([pos, word]);
    }
  }
  if (positions.length === 0) return null;
  positions.sort((a, b) => a[0] - b[0]);
  return positions.map(([, word]) => word).join(" ");
}

function normalizeOrcid(orcid: string | null | undefined): string | undefined {
  if (!orcid) return undefined;
  return orcid.replace(/^https?:\/\/orcid\.org\//, "");
}

function normalizeDoiValue(doi: string | null | undefined): string | null {
  if (!doi) return null;
  return doi.replace(/^https?:\/\/(dx\.)?doi\.org\//, "");
}

function openAlexBibliographic(work: OpenAlexWork): BibliographicDetail {
  // publication_date is "YYYY-MM-DD"; publication_year is the fallback when the
  // full date is absent, which is common for older records.
  const [year, month, day] = (work.publication_date ?? "").split("-").map(Number);
  const issued = year
    ? { year, month: month || undefined, day: day || undefined }
    : work.publication_year
      ? { year: work.publication_year }
      : null;

  return {
    volume: work.biblio?.volume ?? null,
    issue: work.biblio?.issue ?? null,
    firstPage: work.biblio?.first_page ?? null,
    lastPage: work.biblio?.last_page ?? null,
    publisher: work.primary_location?.source?.host_organization_name ?? null,
    containerTitle: work.primary_location?.source?.display_name ?? null,
    type: work.type ?? null,
    issued,
    issn: work.primary_location?.source?.issn_l ?? null,
    isbn: null,
  };
}

function openAlexTopics(work: OpenAlexWork): RawWorkTopic[] | undefined {
  const concepts = work.concepts ?? [];
  if (concepts.length === 0) return undefined;
  return concepts
    .filter((c) => c.display_name)
    .map((c) => ({ name: c.display_name, score: c.score ?? 0 }));
}

export function mapOpenAlexWork(work: OpenAlexWork): RawWork {
  const authors: RawWorkAuthor[] = (work.authorships ?? []).map((a) => ({
    name: a.author.display_name,
    orcid: normalizeOrcid(a.author.orcid),
  }));

  return {
    sourceId: "openalex",
    sourceRecordId: work.id,
    doi: normalizeDoiValue(work.doi),
    title: work.display_name ?? work.title ?? "Untitled",
    abstract: reconstructAbstract(work.abstract_inverted_index),
    authors,
    year: work.publication_year ?? null,
    venue: work.primary_location?.source?.display_name ?? null,
    citationCount: work.cited_by_count ?? null,
    isOpenAccess: work.open_access?.is_oa ?? work.primary_location?.is_oa ?? null,
    pdfUrl: work.primary_location?.pdf_url ?? work.open_access?.oa_url ?? null,
    landingPageUrl: work.primary_location?.landing_page_url ?? work.id,
    bibliographic: openAlexBibliographic(work),
    topics: openAlexTopics(work),
    raw: work,
  };
}
