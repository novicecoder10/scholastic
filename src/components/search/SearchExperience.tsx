"use client";

import { useMemo, useState } from "react";
import type { SearchResponse } from "@/lib/types/search";
import { FilterSidebar } from "@/components/search/FilterSidebar";
import { ResultList } from "@/components/search/ResultList";
import { EmptyState } from "@/components/search/EmptyState";
import { DegradedBanner } from "@/components/search/DegradedBanner";
import { applyFilters, EMPTY_FILTERS, type SearchFilters } from "@/components/search/filters";
import { TopicsPanel } from "@/components/topics/TopicsPanel";

export function SearchExperience({
  response,
  openSynthesis = false,
  savedWorkKeys = [],
}: {
  response: SearchResponse;
  /** Set by the homepage's "Literature review" quick action — same results,
   * with the multi-paper synthesis chat already open. */
  openSynthesis?: boolean;
  /** Passed as an array rather than a Set: this crosses the server/client
   * boundary, where a Set does not serialise. */
  savedWorkKeys?: string[];
}) {
  const [filters, setFilters] = useState<SearchFilters>(EMPTY_FILTERS);
  const saved = useMemo(() => new Set(savedWorkKeys), [savedWorkKeys]);

  const availableSources = useMemo(
    () =>
      response.providerStatuses
        .filter((p) => p.status !== "disabled")
        .map((p) => ({ id: p.providerId, displayName: p.displayName })),
    [response.providerStatuses],
  );

  const MAX_VENUE_FACETS = 15;
  const availableVenues = useMemo(() => {
    const counts = new Map<string, number>();
    for (const work of response.results) {
      if (!work.venue) continue;
      counts.set(work.venue, (counts.get(work.venue) ?? 0) + 1);
    }
    return Array.from(counts, ([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, MAX_VENUE_FACETS);
  }, [response.results]);

  const filteredResults = useMemo(
    () => applyFilters(response.results, filters),
    [response.results, filters],
  );

  const allSourcesDown =
    response.providerStatuses.length > 0 &&
    response.providerStatuses.every((p) => p.status !== "ok");

  return (
    <div className="flex w-full flex-col gap-6 sm:flex-row sm:gap-8">
      <FilterSidebar
        filters={filters}
        onChange={setFilters}
        availableSources={availableSources}
        availableVenues={availableVenues}
      />

      <div className="min-w-0 flex-1">
        <DegradedBanner providerStatuses={response.providerStatuses} />

        {response.results.length > 0 && (
          <TopicsPanel
            works={response.results}
            selected={filters.topics}
            onSelectionChange={(topics) => setFilters((prev) => ({ ...prev, topics }))}
          />
        )}

        {allSourcesDown ? (
          <EmptyState variant="all-sources-down" />
        ) : response.results.length === 0 ? (
          <EmptyState variant="no-results" />
        ) : filteredResults.length === 0 ? (
          <EmptyState variant="filtered-to-nothing" />
        ) : (
          <ResultList
            results={filteredResults}
            totalBeforeFilters={response.results.length}
            openSynthesis={openSynthesis}
            savedWorkKeys={saved}
            query={response.query}
          />
        )}
      </div>
    </div>
  );
}
