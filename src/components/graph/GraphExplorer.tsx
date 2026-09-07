"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { seedGraph, type SeedRoot } from "@/lib/graph/build";
import type { CitationRef, GraphState } from "@/lib/graph/model";

const CitationGraph = dynamic(
  () => import("@/components/search/CitationGraph").then((m) => m.CitationGraph),
  { ssr: false },
);

/**
 * Fetches every seed's citations in parallel, then hands one merged graph to
 * the renderer.
 *
 * Client-side rather than on the server, because twenty seeds is twenty
 * citation lookups and blocking the page render on all of them would make the
 * explorer look broken while it worked. Progress is reported instead.
 *
 * The graph is handed over **once**, when every seed has settled. The renderer
 * owns its state from that point — expansions, collapses, filters — so feeding
 * it a growing graph would either discard the user's exploration on each
 * update or silently ignore the update. One handover is the honest shape.
 */
export function GraphExplorer({
  seeds,
  libraryKeys,
  anonymous,
}: {
  seeds: SeedRoot[];
  libraryKeys: string[];
  anonymous: boolean;
}) {
  const [state, setState] = useState<GraphState | null>(null);
  const [loaded, setLoaded] = useState(0);
  const [failed, setFailed] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const refs = new Map<string, { citing: CitationRef[]; cited: CitationRef[] }>();
    let settled = 0;
    let errors = 0;

    void Promise.all(
      seeds.map(async (seed) => {
        try {
          const response = await fetch(
            `/api/works/${encodeURIComponent(seed.workKey)}/citations`,
          );
          if (!response.ok) throw new Error(String(response.status));
          const body = (await response.json()) as {
            citing: CitationRef[];
            cited: CitationRef[];
          };
          refs.set(seed.workKey, body);
        } catch {
          // One seed with no citation data is a thinner graph, not a failure.
          errors += 1;
        } finally {
          settled += 1;
          if (!cancelled) setLoaded(settled);
        }
      }),
    ).then(() => {
      if (cancelled) return;
      setFailed(errors);
      setState(seedGraph(seeds, refs));
    });

    return () => {
      cancelled = true;
    };
  }, [seeds]);

  const keys = useMemo(() => new Set(libraryKeys), [libraryKeys]);

  if (!state) {
    return (
      <p className="text-muted text-sm" role="status">
        Loading citations… <span className="metric">{loaded}</span> of{" "}
        <span className="metric">{seeds.length}</span> papers.
      </p>
    );
  }

  return (
    <div>
      {failed > 0 && (
        <p className="text-muted mb-2 text-xs">
          <span className="metric">{failed}</span> of{" "}
          <span className="metric">{seeds.length}</span> papers had no citation data available.
        </p>
      )}
      <CitationGraph initialState={state} height={620} libraryKeys={keys} />
      {anonymous && (
        <p className="text-muted mt-3 text-xs">
          Sign in to see which of these papers are already in your library.
        </p>
      )}
    </div>
  );
}
