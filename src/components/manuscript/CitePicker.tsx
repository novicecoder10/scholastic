"use client";

import { useMemo, useState } from "react";
import type { SavedWorkOption } from "@/components/manuscript/ManuscriptEditor";

/** Inserting from the library. The picker exists rather than a search box
 * because a manuscript citation should point at something the writer has
 * already read and kept. */
export function CitePicker({
  works,
  cited,
  onInsert,
}: {
  works: SavedWorkOption[];
  cited: Set<string>;
  onInsert: (workKey: string) => void;
}) {
  const [query, setQuery] = useState("");

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return works.slice(0, 8);
    return works
      .filter(
        (w) =>
          w.title.toLowerCase().includes(needle) ||
          w.authors.some((a) => a.toLowerCase().includes(needle)),
      )
      .slice(0, 8);
  }, [works, query]);

  return (
    <section>
      <h2 className="text-ink mb-2 text-sm font-semibold">Cite from your library</h2>
      {works.length === 0 ? (
        <p className="text-muted text-sm">
          Nothing saved yet. Save papers from search and they appear here.
        </p>
      ) : (
        <>
          <label htmlFor="cite-search" className="sr-only">
            Search your library
          </label>
          <input
            id="cite-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search saved papers…"
            className="border-line bg-page text-ink w-full rounded-lg border px-3 py-1.5 text-sm outline-none"
          />
          <ul className="mt-2 space-y-1">
            {matches.map((work) => (
              <li key={work.workKey}>
                <button
                  type="button"
                  onClick={() => onInsert(work.workKey)}
                  className="hover:bg-surface-2 w-full rounded-lg px-2 py-1.5 text-left text-xs transition-colors"
                >
                  <span className="text-ink line-clamp-2">{work.title}</span>
                  <span className="text-muted">
                    {work.authors[0] ?? "Unknown"} · {work.year ?? "n.d."}
                    {cited.has(work.workKey) ? " · already cited" : ""}
                  </span>
                </button>
              </li>
            ))}
            {matches.length === 0 && <li className="text-muted px-2 text-xs">No matches.</li>}
          </ul>
        </>
      )}
    </section>
  );
}
