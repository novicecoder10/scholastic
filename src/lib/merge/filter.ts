import type { CanonicalWork } from "@/lib/types/work";

export interface WorkFilters {
  yearFrom?: number;
  yearTo?: number;
  openAccessOnly?: boolean;
  minCitations?: number;
  sources?: string[];
  venues?: string[];
}

/**
 * Applied after ranking, over the full merged result set. Shared by the API
 * route (server-side, real filtering of the request) and the frontend's
 * client-side filter sidebar (instant re-filtering of an already-fetched page
 * without a new request) so the two never drift out of sync.
 */
export function filterWorks(results: CanonicalWork[], filters: WorkFilters): CanonicalWork[] {
  return results.filter((work) => {
    if (filters.yearFrom != null && (work.year == null || work.year < filters.yearFrom))
      return false;
    if (filters.yearTo != null && (work.year == null || work.year > filters.yearTo)) return false;
    if (filters.openAccessOnly && !work.isOpenAccess) return false;
    if (filters.minCitations != null && (work.citationCount ?? 0) < filters.minCitations)
      return false;
    if (filters.sources && filters.sources.length > 0) {
      const sourceSet = new Set(filters.sources);
      if (!work.sources.some((s) => sourceSet.has(s.sourceId))) return false;
    }
    if (filters.venues && filters.venues.length > 0) {
      if (!work.venue || !new Set(filters.venues).has(work.venue)) return false;
    }
    return true;
  });
}
