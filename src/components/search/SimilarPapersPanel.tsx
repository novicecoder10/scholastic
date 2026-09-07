"use client";

import { useState, type SyntheticEvent } from "react";

interface SimilarWorkRef {
  workKey: string;
  title: string;
  authors: { name: string; orcid?: string }[];
  year: number | null;
  venue: string | null;
  doi: string | null;
  landingPageUrl: string | null;
  pdfUrl: string | null;
  isOpenAccess: boolean | null;
  citationCount: number | null;
  similarity: number;
}

type SimilarPapersState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; results: SimilarWorkRef[] }
  | { status: "error" };

/**
 * Native <details> so the affordance and fetch-once-per-work pattern work
 * without extra state management — same pattern as CitationsPanel.tsx. An
 * empty result set is rendered as a plain "none yet" message, not an error:
 * candidates are limited to works already present in the corpus (see
 * KNOWN_LIMITATIONS.md), so sparse results are expected, especially early on.
 */
export function SimilarPapersPanel({ workKey }: { workKey: string }) {
  const [state, setState] = useState<SimilarPapersState>({ status: "idle" });

  async function handleToggle(event: SyntheticEvent<HTMLDetailsElement>) {
    if (!event.currentTarget.open || state.status !== "idle") return;
    setState({ status: "loading" });
    try {
      const response = await fetch(`/api/works/${encodeURIComponent(workKey)}/similar`);
      if (!response.ok) {
        setState({ status: "error" });
        return;
      }
      const body = (await response.json()) as { results: SimilarWorkRef[] };
      setState({ status: "success", results: body.results });
    } catch {
      setState({ status: "error" });
    }
  }

  return (
    <details className="mt-2 text-sm" onToggle={handleToggle}>
      <summary className="text-muted hover:text-accent cursor-pointer text-xs font-medium transition-colors">
        Similar papers
      </summary>
      <div className="text-ink/80 mt-2 space-y-2">
        {state.status === "loading" && <p className="text-muted">Finding similar papers…</p>}
        {state.status === "error" && (
          <p className="text-danger">Couldn&apos;t load similar papers right now.</p>
        )}
        {state.status === "success" && state.results.length === 0 && (
          <p className="text-muted">
            No similar papers found yet — this grows as more papers are searched.
          </p>
        )}
        {state.status === "success" && state.results.length > 0 && (
          <ul className="ml-4 list-disc space-y-1">
            {state.results.map((r) => (
              <li key={r.workKey}>
                {r.landingPageUrl ? (
                  <a
                    href={r.landingPageUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-link hover:underline"
                  >
                    {r.title}
                  </a>
                ) : (
                  <span>{r.title}</span>
                )}
                {r.year != null && ` (${r.year})`}
                {r.venue && ` · ${r.venue}`}
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}
