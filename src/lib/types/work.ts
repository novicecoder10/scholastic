import type { BibliographicDetail, RawWorkAuthor, RawWorkTopic } from "@/lib/providers/types";

export interface CanonicalWorkSource {
  sourceId: string;
  sourceRecordId: string;
  citationCount: number | null;
}

export interface CanonicalWork {
  /** Stable within a single search response; not a persisted database id. */
  id: string;
  /** Stable across separate HTTP requests — see lib/ai/workKey.ts. Used to
   * reference this work from summary/citation/chat features. */
  workKey: string;
  doi: string | null;
  title: string;
  abstract: string | null;
  authors: RawWorkAuthor[];
  year: number | null;
  venue: string | null;
  /** Max citation count across all contributing sources. See CanonicalWorkSource for per-source counts. */
  citationCount: number | null;
  isOpenAccess: boolean;
  pdfUrl: string | null;
  landingPageUrl: string | null;
  sources: CanonicalWorkSource[];
  /** Citation-grade detail, taken whole from one source or absent entirely —
   * never assembled across sources. Null means the citation formatters mark
   * their output incomplete rather than inventing a volume. */
  bibliographic: BibliographicDetail | null;
  /** Source-assigned topical concepts, deduped across the cluster. Empty when
   * no contributing source supplied any (today: only OpenAlex does). */
  topics: RawWorkTopic[];
  score: number;
}
