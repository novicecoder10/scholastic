"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CITATION_STYLES, formatAllStyles, type CitationStyle } from "@/lib/citations";
import type { CanonicalWork } from "@/lib/types/work";

/**
 * Citation generation is entirely client-side because it is entirely
 * deterministic — no LLM, no network, no route. Everything it needs is already
 * in the `CanonicalWork` the card was rendered from, so a round trip would buy
 * nothing but latency.
 */
export function CiteButton({ work }: { work: CanonicalWork }) {
  const [open, setOpen] = useState(false);
  const [style, setStyle] = useState<CitationStyle>("apa");
  const [copied, setCopied] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const citations = useMemo(() => formatAllStyles(work), [work]);
  const current = citations[style];

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  async function copy() {
    await navigator.clipboard.writeText(current.text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div ref={containerRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="border-line text-muted hover:border-accent hover:text-accent rounded-full border px-3 py-1 text-xs font-medium transition-colors"
      >
        Cite
      </button>

      {open && (
        <div className="border-line bg-surface absolute top-full left-0 z-20 mt-2 w-[min(28rem,calc(100vw-2rem))] rounded-xl border p-3 shadow-lg">
          <div role="tablist" aria-label="Citation style" className="mb-2 flex flex-wrap gap-1">
            {CITATION_STYLES.map((option) => (
              <button
                key={option.id}
                type="button"
                role="tab"
                aria-selected={style === option.id}
                onClick={() => setStyle(option.id)}
                className={`rounded-full px-2.5 py-1 text-xs transition-colors ${
                  style === option.id ? "bg-surface-2 text-ink" : "text-muted hover:text-ink"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>

          <pre className="border-line bg-page text-ink max-h-56 overflow-auto rounded-lg border p-2.5 text-xs whitespace-pre-wrap">
            {current.text}
          </pre>

          {/* Surfaced, never hidden: an incomplete citation the user can finish
              beats an invented volume, but only if they are told which. */}
          {current.note && <p className="text-muted mt-2 text-[11px]">{current.note}</p>}

          <div className="mt-2 flex justify-end">
            <button
              type="button"
              onClick={() => void copy()}
              className="bg-accent-solid text-accent-ink hover:bg-accent-solid-hover rounded-full px-3 py-1 text-xs font-medium transition-colors"
            >
              {copied ? "Copied ✓" : "Copy"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
