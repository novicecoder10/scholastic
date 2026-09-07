import type { RawWork, RawWorkAuthor } from "@/lib/providers/types";

export interface UnpaywallZAuthor {
  given?: string;
  family?: string;
}

export interface UnpaywallOaLocation {
  url?: string;
  url_for_pdf?: string | null;
}

export interface UnpaywallDataFormat {
  doi: string;
  title: string;
  year?: number | null;
  journal_name?: string | null;
  is_oa: boolean;
  best_oa_location?: UnpaywallOaLocation | null;
  z_authors?: UnpaywallZAuthor[] | null;
}

export interface UnpaywallSearchResult {
  response: UnpaywallDataFormat;
  score: number;
}

export interface UnpaywallSearchResponse {
  total_results: number;
  results: UnpaywallSearchResult[];
}

export function mapUnpaywallResult(result: UnpaywallSearchResult): RawWork {
  const { response } = result;
  const authors: RawWorkAuthor[] = (response.z_authors ?? []).map((a) => ({
    name: [a.given, a.family].filter(Boolean).join(" ") || "Unknown Author",
  }));

  return {
    sourceId: "unpaywall",
    sourceRecordId: response.doi,
    doi: response.doi,
    title: response.title,
    // Unpaywall is an OA-status/location index, not a metadata-rich discovery
    // source — it doesn't provide abstracts.
    abstract: null,
    authors,
    year: response.year ?? null,
    venue: response.journal_name ?? null,
    citationCount: null,
    isOpenAccess: response.is_oa,
    pdfUrl: response.best_oa_location?.url_for_pdf ?? response.best_oa_location?.url ?? null,
    landingPageUrl: `https://doi.org/${response.doi}`,
    raw: result,
  };
}
