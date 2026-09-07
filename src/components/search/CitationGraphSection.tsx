"use client";

import Link from "next/link";
import { useState, type SyntheticEvent } from "react";
import dynamic from "next/dynamic";
import { seedGraph } from "@/lib/graph/build";

const CitationGraph = dynamic(
  () => import("@/components/search/CitationGraph").then((m) => m.CitationGraph),
  { ssr: false },
);

interface CitationRef {
  doi: string | null;
  title: string | null;
  year: number | null;
}

type FetchState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; citing: CitationRef[]; cited: CitationRef[] }
  | { status: "error" };

/**
 * Self-contained citation graph section — its own heading, its own data fetch,
 * not nested inside the flat citation list.
 *
 * This stays after #9 promoted the graph to a full page, because it is how
 * anyone discovers the graph exists at all. It now links out to the explorer
 * rather than trying to be one.
 */
export function CitationGraphSection({
  workKey,
  doi,
  title,
}: {
  workKey: string;
  doi: string | null;
  title: string;
}) {
  const [state, setState] = useState<FetchState>({ status: "idle" });

  async function handleToggle(event: SyntheticEvent<HTMLDetailsElement>) {
    if (!event.currentTarget.open || state.status !== "idle") return;
    setState({ status: "loading" });
    try {
      const response = await fetch(`/api/works/${encodeURIComponent(workKey)}/citations`);
      if (!response.ok) {
        setState({ status: "error" });
        return;
      }
      const body = (await response.json()) as {
        citing: CitationRef[];
        cited: CitationRef[];
      };
      setState({ status: "success", citing: body.citing, cited: body.cited });
    } catch {
      setState({ status: "error" });
    }
  }

  return (
    <details className="mt-3" onToggle={handleToggle}>
      <summary className="text-muted hover:text-accent cursor-pointer text-xs font-medium transition-colors">
        Citation graph
      </summary>
      <div className="mt-2">
        {state.status === "loading" && <p className="text-muted text-sm">Loading citation data…</p>}
        {state.status === "error" && (
          <p className="text-danger text-sm">Couldn&apos;t load citation data right now.</p>
        )}
        {state.status === "success" && (
          <>
            <div className="mb-2 flex justify-end">
              <Link
                href={`/graph?work=${encodeURIComponent(workKey)}`}
                className="text-link text-xs hover:underline"
              >
                Open in explorer ↗
              </Link>
            </div>
            <CitationGraph
              initialState={seedGraph(
                [{ workKey, title, doi, year: null }],
                new Map([[workKey, { citing: state.citing, cited: state.cited }]]),
              )}
            />
          </>
        )}
      </div>
    </details>
  );
}
