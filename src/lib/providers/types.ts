export interface SearchOptions {
  query: string;
  /** 1-indexed page number. */
  page?: number;
  /** Requested page size; each provider clamps to its own max. */
  perPage?: number;
  yearFrom?: number;
  yearTo?: number;
  signal?: AbortSignal;
}

export interface RawWorkAuthor {
  name: string;
  orcid?: string;
}

/**
 * Everything a citation style needs that `RawWork`'s core fields don't carry.
 *
 * Selected as a whole block by `pickBibliographic` rather than merged field by
 * field — a citation assembled from OpenAlex's volume, PubMed's page range and
 * Crossref's issue looks authoritative and can be wrong in a way the reader
 * cannot detect. One source, or nothing.
 */
export interface BibliographicDetail {
  volume: string | null;
  issue: string | null;
  firstPage: string | null;
  lastPage: string | null;
  publisher: string | null;
  /** Journal or book title exactly as the source states it. */
  containerTitle: string | null;
  /** journal-article | book-chapter | preprint | ... — as the source labels it. */
  type: string | null;
  issued: { year: number; month?: number; day?: number } | null;
  issn: string | null;
  isbn: string | null;
}

/** A topical concept the source attaches to a work, with its own confidence. */
export interface RawWorkTopic {
  name: string;
  score: number;
}

export interface RawWork {
  sourceId: string;
  /** The provider's own native identifier (OpenAlex W-id, PMID, arXiv id, DOI, ...). */
  sourceRecordId: string;
  doi: string | null;
  title: string;
  abstract: string | null;
  authors: RawWorkAuthor[];
  year: number | null;
  venue: string | null;
  citationCount: number | null;
  isOpenAccess: boolean | null;
  pdfUrl: string | null;
  landingPageUrl: string | null;
  /** Citation-grade detail. Optional and additive: only Crossref, OpenAlex,
   * PubMed and Europe PMC populate it, and a work without one produces a
   * citation marked incomplete rather than a partially-invented one. */
  bibliographic?: BibliographicDetail;
  /** Source-assigned topical concepts. OpenAlex only — see lib/topics/. */
  topics?: RawWorkTopic[];
  /** Original provider payload, kept for debugging and future re-mapping. */
  raw: unknown;
}

export interface RawSearchResult {
  works: RawWork[];
  /** Provider-reported total, if the API exposes one. Not always accurate/available. */
  totalCount: number | null;
}

export type ProviderHealth = "up" | "degraded" | "down" | "disabled";

export interface ProviderMeta {
  id: string;
  displayName: string;
  requiresCredential: boolean;
  isEnabled: boolean;
  /** Overrides the orchestrator's default per-provider timeout, in milliseconds. */
  defaultTimeoutMs?: number;
}

export interface ProviderAdapter {
  meta: ProviderMeta;
  /** Returns false (never throws) when required credentials are absent. */
  isConfigured(): boolean;
  search(options: SearchOptions): Promise<RawSearchResult>;
}

export class ProviderSkippedError extends Error {
  constructor(
    public readonly providerId: string,
    public readonly reason: "circuit_open" | "not_configured",
  ) {
    super(`Provider "${providerId}" skipped: ${reason}`);
    this.name = "ProviderSkippedError";
  }
}

export class ProviderTimeoutError extends Error {
  constructor(
    public readonly providerId: string,
    public readonly timeoutMs: number,
  ) {
    super(`Provider "${providerId}" timed out after ${timeoutMs}ms`);
    this.name = "ProviderTimeoutError";
  }
}
