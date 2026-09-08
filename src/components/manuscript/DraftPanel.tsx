"use client";

import { useState } from "react";
import { CostHint } from "@/components/credits/CostHint";
import type { SavedWorkOption } from "@/components/manuscript/ManuscriptEditor";

export type DraftSegment = { kind: "text"; value: string } | { kind: "citation"; workKey: string };

/**
 * The one generative mode: a related-work draft from sources the writer chose,
 * with a citation on every sentence.
 *
 * Sentences that came back uncited, or citing something outside the chosen set,
 * are stripped server-side before this ever sees them. If that empties the
 * draft, nothing is inserted and the panel says so — which is a better outcome
 * than dropping unattributed prose into a manuscript.
 */
export function DraftPanel({
  publicId,
  works,
  enabled,
  onInsert,
  onNotice,
}: {
  publicId: string;
  works: SavedWorkOption[];
  enabled: boolean;
  onInsert: (sentences: DraftSegment[][]) => void;
  onNotice: (message: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [topic, setTopic] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  function toggle(workKey: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(workKey)) next.delete(workKey);
      else next.add(workKey);
      return next;
    });
  }

  async function draft() {
    setBusy(true);
    onNotice(null);
    try {
      const response = await fetch(`/api/manuscripts/${publicId}/draft`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic, workKeys: [...selected] }),
      });
      const body = (await response.json().catch(() => null)) as {
        error?: string;
        inserted?: boolean;
        reason?: string;
        sentences?: DraftSegment[][];
        droppedUncited?: number;
        droppedForeign?: number;
      } | null;

      if (!response.ok) {
        onNotice(body?.error ?? "Couldn't draft that section.");
        return;
      }
      if (!body?.inserted) {
        onNotice(body?.reason ?? "Nothing was inserted.");
        return;
      }

      onInsert(body.sentences ?? []);
      const dropped = (body.droppedUncited ?? 0) + (body.droppedForeign ?? 0);
      onNotice(
        dropped > 0
          ? `Drafted. ${dropped} uncited or unsupported ${
              dropped === 1 ? "sentence was" : "sentences were"
            } removed before insertion.`
          : "Drafted. Every sentence cites one of your chosen sources — check them before you keep them.",
      );
      setOpen(false);
    } finally {
      setBusy(false);
    }
  }

  if (!enabled) {
    return (
      <section>
        <h2 className="text-ink mb-2 text-sm font-semibold">Grounded draft</h2>
        <p className="text-muted text-sm">
          No AI provider is configured, so drafting is off. Writing, citing and exporting all still
          work.
        </p>
      </section>
    );
  }

  return (
    <section>
      <h2 className="text-ink mb-2 text-sm font-semibold">Grounded draft</h2>
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          disabled={works.length === 0}
          className="border-line text-muted hover:border-accent hover:text-accent rounded-full border px-3 py-1 text-xs font-medium transition-colors disabled:opacity-50"
        >
          {works.length === 0 ? "Save some papers first" : "Draft from sources"}
        </button>
      ) : (
        <div className="space-y-2">
          <label htmlFor="draft-topic" className="text-muted text-xs">
            What is this section about?
          </label>
          <input
            id="draft-topic"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="e.g. evidence for oxidative stress as a shared mechanism"
            className="border-line bg-page text-ink w-full rounded-lg border px-3 py-1.5 text-sm outline-none"
          />
          <fieldset className="border-line max-h-48 overflow-y-auto rounded-lg border p-2">
            <legend className="text-muted px-1 text-xs">Sources it may cite</legend>
            {works.map((work) => (
              <label key={work.workKey} className="text-ink flex gap-2 px-1 py-1 text-xs">
                <input
                  type="checkbox"
                  checked={selected.has(work.workKey)}
                  onChange={() => toggle(work.workKey)}
                />
                <span className="line-clamp-2">{work.title}</span>
              </label>
            ))}
          </fieldset>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={!topic.trim() || selected.size === 0 || busy}
              onClick={() => void draft()}
              className="bg-accent-solid text-accent-ink rounded-full px-3 py-1.5 text-sm font-medium disabled:opacity-50"
            >
              {busy ? "Drafting…" : "Draft"}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-muted hover:text-ink text-sm"
            >
              Cancel
            </button>
            <CostHint feature="grounded_draft" />
          </div>
        </div>
      )}
    </section>
  );
}
