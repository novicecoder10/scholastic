import type { SearchFilters } from "@/components/search/filters";

interface FilterSidebarProps {
  filters: SearchFilters;
  onChange: (filters: SearchFilters) => void;
  availableSources: { id: string; displayName: string }[];
  availableVenues: { name: string; count: number }[];
}

export function FilterSidebar({
  filters,
  onChange,
  availableSources,
  availableVenues,
}: FilterSidebarProps) {
  function update(patch: Partial<SearchFilters>) {
    onChange({ ...filters, ...patch });
  }

  function toggleSource(id: string) {
    const next = new Set(filters.sources);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    update({ sources: next });
  }

  function toggleVenue(name: string) {
    const next = new Set(filters.venues);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    update({ venues: next });
  }

  return (
    <aside
      aria-label="Filters"
      className="border-line bg-surface w-full shrink-0 rounded-xl border p-4 sm:sticky sm:top-20 sm:h-fit sm:w-56"
    >
      <fieldset className="mb-6 min-w-0">
        <legend className="text-muted mb-2 text-[11px] font-semibold tracking-wide uppercase">
          Year
        </legend>
        <div className="flex items-center gap-2">
          <label htmlFor="year-from" className="sr-only">
            From year
          </label>
          <input
            id="year-from"
            type="number"
            inputMode="numeric"
            placeholder="From"
            value={filters.yearFrom ?? ""}
            onChange={(e) => update({ yearFrom: e.target.value ? Number(e.target.value) : null })}
            className="metric border-line bg-page text-ink focus-visible:border-accent w-20 rounded-lg border px-2 py-1 text-sm outline-none"
          />
          <span aria-hidden="true">–</span>
          <label htmlFor="year-to" className="sr-only">
            To year
          </label>
          <input
            id="year-to"
            type="number"
            inputMode="numeric"
            placeholder="To"
            value={filters.yearTo ?? ""}
            onChange={(e) => update({ yearTo: e.target.value ? Number(e.target.value) : null })}
            className="metric border-line bg-page text-ink focus-visible:border-accent w-20 rounded-lg border px-2 py-1 text-sm outline-none"
          />
        </div>
      </fieldset>

      <fieldset className="mb-6 min-w-0">
        <legend className="text-muted mb-2 text-[11px] font-semibold tracking-wide uppercase">
          Access
        </legend>
        <label htmlFor="oa-only" className="flex items-center gap-2 text-sm">
          <input
            id="oa-only"
            type="checkbox"
            checked={filters.openAccessOnly}
            onChange={(e) => update({ openAccessOnly: e.target.checked })}
            className="h-4 w-4 shrink-0 accent-[var(--accent-solid)]"
          />
          Open access only
        </label>
      </fieldset>

      <fieldset className="mb-6 min-w-0">
        <legend className="text-muted mb-2 text-[11px] font-semibold tracking-wide uppercase">
          Minimum citations
        </legend>
        <label htmlFor="min-citations" className="sr-only">
          Minimum citation count
        </label>
        <input
          id="min-citations"
          type="number"
          inputMode="numeric"
          min={0}
          placeholder="0"
          value={filters.minCitations ?? ""}
          onChange={(e) => update({ minCitations: e.target.value ? Number(e.target.value) : null })}
          className="metric border-line bg-page text-ink focus-visible:border-accent w-24 rounded-lg border px-2 py-1 text-sm outline-none"
        />
      </fieldset>

      <fieldset className="mb-6 min-w-0">
        <legend className="text-muted mb-2 text-[11px] font-semibold tracking-wide uppercase">
          Sources
        </legend>
        <div className="flex flex-col gap-1.5">
          {availableSources.map((source) => (
            <label
              key={source.id}
              htmlFor={`source-${source.id}`}
              className="flex min-w-0 items-center gap-2 text-sm"
            >
              <input
                id={`source-${source.id}`}
                type="checkbox"
                checked={filters.sources.has(source.id)}
                onChange={() => toggleSource(source.id)}
                className="h-4 w-4 shrink-0 accent-[var(--accent-solid)]"
              />
              {source.displayName}
            </label>
          ))}
        </div>
      </fieldset>

      {availableVenues.length > 0 && (
        <fieldset className="min-w-0">
          <legend className="text-muted mb-2 text-[11px] font-semibold tracking-wide uppercase">
            Venue
          </legend>
          <div className="flex flex-col gap-1.5">
            {availableVenues.map((venue, index) => (
              <label
                key={venue.name}
                htmlFor={`venue-${index}`}
                className="flex min-w-0 items-center gap-2 text-sm"
              >
                <input
                  id={`venue-${index}`}
                  type="checkbox"
                  checked={filters.venues.has(venue.name)}
                  onChange={() => toggleVenue(venue.name)}
                  className="h-4 w-4 shrink-0 accent-[var(--accent-solid)]"
                />
                <span className="min-w-0 flex-1 truncate">{venue.name}</span>
                <span className="metric text-muted shrink-0">({venue.count})</span>
              </label>
            ))}
          </div>
        </fieldset>
      )}
    </aside>
  );
}
