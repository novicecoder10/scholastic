import Link from "next/link";
import type { CanonicalWork } from "@/lib/types/work";
import { ResultCard } from "@/components/search/ResultCard";
import { ChatPanel } from "@/components/search/ChatPanel";

interface ResultListProps {
  results: CanonicalWork[];
  totalBeforeFilters: number;
  /** Present when a query produced these results, so the whole set can be
   * opened as one graph. Seeing that four of twenty results cite the same 1998
   * paper is the point of the multi-root form. */
  query?: string;
  openSynthesis?: boolean;
  savedWorkKeys?: ReadonlySet<string>;
}

export function ResultList({
  results,
  totalBeforeFilters,
  openSynthesis = false,
  savedWorkKeys,
  query,
}: ResultListProps) {
  return (
    <section aria-label="Search results" className="flex-1">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-muted text-sm" role="status" aria-live="polite">
          Showing <span className="metric text-ink">{results.length}</span> of{" "}
          <span className="metric text-ink">{totalBeforeFilters}</span> result
          {totalBeforeFilters === 1 ? "" : "s"}
        </p>
        {query && results.length > 1 && (
          <Link
            href={`/graph?from=search&q=${encodeURIComponent(query)}`}
            className="text-link text-xs hover:underline"
          >
            See these as a citation graph ↗
          </Link>
        )}
      </div>

      {results.length > 1 && (
        <ChatPanel
          works={results.map((w) => ({ workKey: w.workKey, title: w.title, abstract: w.abstract }))}
          toggleLabel="Synthesize across these results"
          placeholder="Ask a question across all these results…"
          emptyStateText="Ask a question and I'll answer using whichever of these results are most relevant."
          defaultOpen={openSynthesis}
        />
      )}

      <ul className="mt-4 flex flex-col gap-3">
        {results.map((work) => (
          <li key={work.id}>
            <ResultCard work={work} saved={savedWorkKeys?.has(work.workKey) ?? false} />
          </li>
        ))}
      </ul>
    </section>
  );
}
