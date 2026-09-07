"use client";

import { useState } from "react";
import { CostHint } from "@/components/credits/CostHint";

interface Candidate {
  workKey: string;
  title: string;
  authors: string[];
  year: number | null;
  venue: string | null;
  source: "library" | "search";
}

/**
 * Find support **suggests**. It never attaches a citation.
 *
 * A correctness rule rather than a UI default: a wrong citation reads as
 * authoritative, is rarely re-checked, and survives into the published version.
 * There is no confidence threshold above which this inserts on its own.
 */
export function SupportPanel({
  claim,
  enabled,
  onInsert,
  onNotice,
}: {
  claim: string;
  enabled: boolean;
  onInsert: (workKey: string) => void;
  onNotice: (message: string | null) => void;
}) {
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [busy, setBusy] = useState(false);

  async function find() {
    setBusy(true);
    onNotice(null);
    try {
      const response = await fetch("/api/manuscripts/support", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ claim }),
      });
      const body = (await response.json().catch(() => null)) as
        | { error?: string; candidates?: Candidate[] }
        | null;
      if (!response.ok) {
        onNotice(body?.error ?? "Couldn't look for support.");
        return;
      }
      setCandidates(body?.candidates ?? []);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <h2 className="text-ink mb-2 text-sm font-semibold">Find support</h2>
      {!enabled ? (
        <p className="text-muted text-sm">
          No AI provider is configured, so this is off. Citing from your library still works.
        </p>
      ) : (
        <>
          <p className="text-muted text-xs">
            Select a claim in the document, then look for papers that support it. Nothing is cited
            until you pick one.
          </p>
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              disabled={!claim.trim() || busy}
              onClick={() => void find()}
              className="border-line text-muted hover:border-accent hover:text-accent rounded-full border px-3 py-1 text-xs font-medium transition-colors disabled:opacity-50"
            >
              {busy ? "Looking…" : "Find support"}
            </button>
            <CostHint feature="find_support" />
          </div>

          {candidates && candidates.length === 0 && (
            <p className="text-muted mt-2 text-xs">Nothing matched that claim.</p>
          )}
          {candidates && candidates.length > 0 && (
            <ul className="mt-2 space-y-1">
              {candidates.map((candidate) => (
                <li key={candidate.workKey}>
                  <button
                    type="button"
                    onClick={() => onInsert(candidate.workKey)}
                    className="hover:bg-surface-2 w-full rounded-lg px-2 py-1.5 text-left text-xs transition-colors"
                  >
                    <span className="text-ink line-clamp-2">{candidate.title}</span>
                    <span className="text-muted">
                      {candidate.authors[0] ?? "Unknown"} · {candidate.year ?? "n.d."} ·{" "}
                      {candidate.source === "library" ? "your library" : "search"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
