"use client";

import type { GraphSummary } from "@/lib/graph/analysis";
import type { GraphFilters } from "@/lib/graph/filter";

/**
 * The cap as a budget rather than a wall.
 *
 * Reaching 150 nodes used to print "expand a different branch" with no
 * mechanism for doing so. The counter is continuous, and the filters give a
 * full graph somewhere to go.
 */
export function GraphControls({
  filters,
  onChange,
  summary,
  nodeCap,
  totalNodes,
}: {
  filters: GraphFilters;
  onChange: (next: GraphFilters) => void;
  summary: GraphSummary;
  nodeCap: number;
  totalNodes: number;
}) {
  const nearCap = totalNodes >= nodeCap * 0.9;

  return (
    <div className="border-line mb-3 flex flex-wrap items-end gap-3 rounded-xl border p-3 text-xs">
      <label className="flex flex-col gap-1">
        <span className="text-muted">From year</span>
        <input
          type="number"
          value={filters.yearFrom ?? ""}
          onChange={(e) =>
            onChange({ ...filters, yearFrom: e.target.value ? Number(e.target.value) : null })
          }
          className="border-line bg-page text-ink w-20 rounded-lg border px-2 py-1 outline-none"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-muted">To year</span>
        <input
          type="number"
          value={filters.yearTo ?? ""}
          onChange={(e) =>
            onChange({ ...filters, yearTo: e.target.value ? Number(e.target.value) : null })
          }
          className="border-line bg-page text-ink w-20 rounded-lg border px-2 py-1 outline-none"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-muted">Min. cited here</span>
        <input
          type="number"
          min={0}
          value={filters.minInDegree}
          onChange={(e) => onChange({ ...filters, minInDegree: Number(e.target.value) || 0 })}
          className="border-line bg-page text-ink w-20 rounded-lg border px-2 py-1 outline-none"
        />
      </label>
      <label className="text-muted flex items-center gap-2">
        <input
          type="checkbox"
          checked={filters.hideUnresolved}
          onChange={(e) => onChange({ ...filters, hideUnresolved: e.target.checked })}
        />
        Hide unresolved
      </label>

      <div className="text-muted ml-auto text-right">
        <p className={nearCap ? "text-danger" : undefined}>
          <span className="metric">{totalNodes}</span> / {nodeCap} nodes
        </p>
        {/*
          Every figure here describes the loaded subgraph and nothing else.
          Citation coverage is incomplete and biased — preprints and non-English
          work are systematically under-linked — so presenting any of this as a
          property of the literature would be a claim the data cannot support.
        */}
        <p>
          <span className="metric">{summary.componentCount}</span> clusters ·{" "}
          <span className="metric">{summary.linkCount}</span> edges
          {summary.unresolvedCount > 0 && (
            <>
              {" "}
              · <span className="metric">{summary.unresolvedCount}</span> unresolved
            </>
          )}
        </p>
        <p className="text-[11px]">within the loaded subgraph</p>
      </div>
    </div>
  );
}
