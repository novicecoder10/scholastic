"use client";

import { useState } from "react";
import type { CanonicalWork } from "@/lib/types/work";
import type { LabelledTheme } from "@/lib/topics/label";

interface Concept {
  name: string;
  count: number;
  workKeys: string[];
}

type PanelState =
  | { status: "closed" }
  | { status: "loading" }
  | { status: "empty" }
  | { status: "error" }
  | { status: "ready"; concepts: Concept[]; themes: LabelledTheme[] | null };

/**
 * The topical structure of the current result set, and — the whole point —
 * a way to narrow by it. A topic list that only displays is decoration; every
 * chip here applies to the same `SearchFilters` the sidebar writes, so the
 * result list narrows in place with no re-query.
 */
export function TopicsPanel({
  works,
  selected,
  onSelectionChange,
}: {
  works: CanonicalWork[];
  selected: Set<string>;
  onSelectionChange: (topics: Set<string>) => void;
}) {
  const [state, setState] = useState<PanelState>({ status: "closed" });

  async function open() {
    setState({ status: "loading" });
    try {
      const response = await fetch("/api/topics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          works: works.map((w) => ({ workKey: w.workKey, topics: w.topics })),
        }),
      });
      if (!response.ok) {
        setState({ status: "error" });
        return;
      }
      const body = (await response.json()) as {
        concepts: Concept[];
        themes: LabelledTheme[] | null;
      };
      setState(body.concepts.length === 0 ? { status: "empty" } : { status: "ready", ...body });
    } catch {
      setState({ status: "error" });
    }
  }

  function toggle(names: string[]) {
    const next = new Set(selected);
    // A theme toggles as a unit: if any of its concepts is already on, the
    // click clears the theme rather than adding the rest.
    const anyOn = names.some((n) => next.has(n));
    for (const name of names) {
      if (anyOn) next.delete(name);
      else next.add(name);
    }
    onSelectionChange(next);
  }

  if (state.status === "closed") {
    return (
      <button
        type="button"
        onClick={() => void open()}
        className="border-line text-muted hover:border-accent hover:text-accent mb-4 rounded-full border px-3 py-1 text-xs font-medium transition-colors"
      >
        Find topics in these results
      </button>
    );
  }

  return (
    <section className="border-line bg-surface mb-4 rounded-xl border p-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-ink text-sm font-semibold">Topics in these results</h2>
        <div className="flex items-center gap-3">
          {selected.size > 0 && (
            <button
              type="button"
              onClick={() => onSelectionChange(new Set())}
              className="text-muted hover:text-ink text-xs transition-colors"
            >
              Clear filter
            </button>
          )}
          <button
            type="button"
            onClick={() => setState({ status: "closed" })}
            aria-label="Close topics"
            className="text-muted hover:text-ink transition-colors"
          >
            ✕
          </button>
        </div>
      </div>

      {state.status === "loading" && <p className="text-muted text-sm">Reading the result set…</p>}
      {state.status === "error" && (
        <p className="text-danger text-sm">Couldn&apos;t work out the topics — try again.</p>
      )}
      {state.status === "empty" && (
        <p className="text-muted text-sm">
          None of these results carry topic data. Only OpenAlex supplies it today, so a result set
          it didn&apos;t contribute to has nothing to group.
        </p>
      )}

      {state.status === "ready" && (
        <>
          {state.themes ? (
            <ul className="space-y-3">
              {state.themes.map((theme) => (
                <li key={theme.label}>
                  <button
                    type="button"
                    onClick={() => toggle(theme.concepts)}
                    aria-pressed={theme.concepts.some((c) => selected.has(c))}
                    className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${
                      theme.concepts.some((c) => selected.has(c))
                        ? "border-accent bg-surface-2"
                        : "border-line hover:border-line-strong"
                    }`}
                  >
                    <span className="text-ink block text-sm font-medium">{theme.label}</span>
                    {theme.description && (
                      <span className="text-muted block text-xs">{theme.description}</span>
                    )}
                    <span className="text-muted mt-1 block text-[11px]">
                      {theme.concepts.join(" · ")}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <>
              {/* No LLM configured, or its labelling didn't survive validation.
                  The ranked concepts are still the real structure of the set. */}
              <p className="text-muted mb-2 text-xs">
                Showing concepts as they came from the sources — AI grouping isn&apos;t available on
                this instance.
              </p>
              <div className="flex flex-wrap gap-1.5">
                {state.concepts.map((concept) => (
                  <button
                    key={concept.name}
                    type="button"
                    onClick={() => toggle([concept.name])}
                    aria-pressed={selected.has(concept.name)}
                    className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                      selected.has(concept.name)
                        ? "border-accent text-accent"
                        : "border-line text-muted hover:text-ink"
                    }`}
                  >
                    {concept.name}
                    <span className="metric text-muted ml-1">{concept.count}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}
