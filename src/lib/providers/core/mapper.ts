import type { RawWork, RawWorkAuthor } from "@/lib/providers/types";

export interface CoreAuthor {
  name: string;
}

export interface CoreJournal {
  title?: string;
}

export interface CoreWork {
  id: string;
  doi?: string | null;
  title: string;
  abstract?: string | null;
  authors?: CoreAuthor[];
  yearPublished?: number | null;
  publisher?: string | null;
  journals?: CoreJournal[];
  downloadUrl?: string | null;
  sourceFulltextUrls?: string[];
}

export interface CoreResponse {
  totalHits: number;
  results: CoreWork[];
}

export function mapCoreWork(work: CoreWork): RawWork {
  const authors: RawWorkAuthor[] = (work.authors ?? []).map((a) => ({ name: a.name }));
  const pdfUrl = work.downloadUrl ?? work.sourceFulltextUrls?.[0] ?? null;

  return {
    sourceId: "core",
    sourceRecordId: work.id,
    doi: work.doi ?? null,
    title: work.title,
    abstract: work.abstract ?? null,
    authors,
    year: work.yearPublished ?? null,
    venue: work.journals?.[0]?.title ?? work.publisher ?? null,
    // CORE aggregates repository metadata but doesn't track citation counts itself.
    citationCount: null,
    // Everything CORE indexes comes from open-access repositories.
    isOpenAccess: true,
    pdfUrl,
    landingPageUrl: work.doi
      ? `https://doi.org/${work.doi}`
      : `https://core.ac.uk/works/${work.id}`,
    raw: work,
  };
}
