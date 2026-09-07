import type { CanonicalWork } from "@/lib/types/work";
import { filterWorks } from "@/lib/merge/filter";

export interface SearchFilters {
  yearFrom: number | null;
  yearTo: number | null;
  openAccessOnly: boolean;
  minCitations: number | null;
  /** Empty set means "all sources". */
  sources: Set<string>;
  /** Empty set means "all venues". */
  venues: Set<string>;
  /** Concept names from the Topics panel. Empty set means "all topics"; a
   * non-empty set matches a work carrying ANY of them. */
  topics: Set<string>;
}

export const EMPTY_FILTERS: SearchFilters = {
  yearFrom: null,
  yearTo: null,
  openAccessOnly: false,
  minCitations: null,
  sources: new Set(),
  venues: new Set(),
  topics: new Set(),
};

/**
 * Thin adapter over the shared lib/merge/filter.ts logic (also used server-side
 * by the API route), so client-side and server-side filtering can never drift
 * apart into two different definitions of "matches these filters."
 */
export function applyFilters(results: CanonicalWork[], filters: SearchFilters): CanonicalWork[] {
  const base = filterWorks(results, {
    yearFrom: filters.yearFrom ?? undefined,
    yearTo: filters.yearTo ?? undefined,
    openAccessOnly: filters.openAccessOnly,
    minCitations: filters.minCitations ?? undefined,
    sources: filters.sources.size > 0 ? Array.from(filters.sources) : undefined,
    venues: filters.venues.size > 0 ? Array.from(filters.venues) : undefined,
  });

  // Topic narrowing stays here rather than in lib/merge/filter.ts because it
  // is a client-side facet only: the search API exposes no topic parameter, so
  // there is no server-side definition for this to drift away from. If one is
  // ever added, this moves down into the shared filter with the rest.
  if (filters.topics.size === 0) return base;
  return base.filter((work) => work.topics.some((topic) => filters.topics.has(topic.name)));
}
