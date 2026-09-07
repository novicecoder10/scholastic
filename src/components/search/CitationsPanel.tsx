"use client";

import { useState, type SyntheticEvent } from "react";

interface CitationRef {
  doi: string | null;
  title: string | null;
  year: number | null;
}

type CitationsState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; citing: CitationRef[]; cited: CitationRef[]; degraded: boolean }
  | { status: "error" };

function CitationList({ label, refs }: { label: string; refs: CitationRef[] }) {
  if (refs.length === 0) {
    return <p className="text-muted">{label}: none found.</p>;
  }

  return (
    <div>
      <p className="text-ink font-medium">
        {label} ({refs.length})
      </p>
      <ul className="ml-4 list-disc space-y-0.5">
        {refs.slice(0, 10).map((ref, i) => (
          <li key={ref.doi ?? i}>
            {ref.doi ? (
              <a
                href={`https://doi.org/${ref.doi}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-link hover:underline"
              >
                {ref.title ?? ref.doi}
              </a>
            ) : (
              <span>{ref.title ?? "Untitled"}</span>
            )}
            {ref.year != null && ` (${ref.year})`}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Native <details> so the affordance and (on expand) a fetch-once-per-work
 * pattern work without extra state management — accessible and keyboard-
 * operable for free, degrades to a plain disclosure with no JS. List-only —
 * the interactive graph opens in its own resizable drawer (`KnowledgeGraphButton`),
 * not nested inside this small disclosure.
 */
export function CitationsPanel({ workKey }: { workKey: string }) {
  const [state, setState] = useState<CitationsState>({ status: "idle" });

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
        degraded: boolean;
      };
      setState({
        status: "success",
        citing: body.citing,
        cited: body.cited,
        degraded: body.degraded,
      });
    } catch {
      setState({ status: "error" });
    }
  }

  return (
    <details className="mt-2 text-sm" onToggle={handleToggle}>
      <summary className="text-muted hover:text-accent cursor-pointer text-xs font-medium transition-colors">
        Citation list
      </summary>
      <div className="text-ink/80 mt-2 space-y-2">
        {state.status === "loading" && <p className="text-muted">Loading citation data…</p>}
        {state.status === "error" && (
          <p className="text-danger">Couldn&apos;t load citation data right now.</p>
        )}
        {state.status === "success" && (
          <>
            {state.degraded && (
              <p className="text-muted text-xs">
                Some citation sources were unavailable or this work has no DOI — results may be
                incomplete.
              </p>
            )}
            <CitationList label="Cited by" refs={state.citing} />
            <CitationList label="References" refs={state.cited} />
          </>
        )}
      </div>
    </details>
  );
}
