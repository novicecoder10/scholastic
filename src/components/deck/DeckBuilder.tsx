"use client";

import { useState } from "react";
import { attributionLine } from "@/lib/capacity/attribution";
import Link from "next/link";
import { CostHint } from "@/components/credits/CostHint";
import { MANUSCRIPT_STYLES } from "@/lib/manuscript/bibliography";
import { bulletSegments, type DeckOutline } from "@/lib/deck/outline";
import type { CitationStyle } from "@/lib/citations";

interface DeckSource {
  workKey: string;
  title: string;
  year: number | null;
  doi: string | null;
  landingPageUrl: string | null;
}

interface DeckResponse {
  topic: string;
  style: CitationStyle;
  outline: DeckOutline;
  empty: boolean;
  markdown: string;
  sources: DeckSource[];
  searched: number;
  /** Named only when a sponsor asked to be. See lib/capacity/attribution.ts. */
  sponsor: string | null;
}

type State =
  | { status: "idle" }
  | { status: "building" }
  | { status: "built"; deck: DeckResponse }
  | { status: "error"; message: string };

/**
 * A deck is generated on an explicit click, never on page load.
 *
 * This is the most expensive single action in the app, and a page that spent
 * credits because someone hit refresh would be a page nobody could afford to
 * revisit. The cost is on the button before it is pressed.
 */
export function DeckBuilder({ initialTopic }: { initialTopic: string }) {
  const [topic, setTopic] = useState(initialTopic);
  const [style, setStyle] = useState<CitationStyle>("apa");
  const [state, setState] = useState<State>({ status: "idle" });
  const [copied, setCopied] = useState(false);

  async function build() {
    const trimmed = topic.trim();
    if (!trimmed) return;
    setState({ status: "building" });
    setCopied(false);
    try {
      const response = await fetch("/api/deck", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: trimmed, style }),
      });
      const body = (await response.json().catch(() => null)) as
        (DeckResponse & { error?: string }) | null;
      if (!response.ok || !body) {
        setState({
          status: "error",
          message: body?.error ?? "Couldn't build that deck right now.",
        });
        return;
      }
      setState({ status: "built", deck: body });
    } catch {
      setState({ status: "error", message: "Couldn't reach the server to build that deck." });
    }
  }

  async function copyMarkdown(markdown: string) {
    try {
      await navigator.clipboard.writeText(markdown);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  const busy = state.status === "building";

  return (
    <div className="flex flex-col gap-5">
      <div className="border-line bg-surface flex flex-col gap-3 rounded-2xl border p-4">
        <label htmlFor="deck-topic" className="text-muted text-xs font-medium">
          What is the talk about?
        </label>
        <textarea
          id="deck-topic"
          rows={2}
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          disabled={busy}
          placeholder="e.g. what limits the accuracy of CRISPR off-target prediction?"
          className="text-ink placeholder:text-muted w-full resize-none bg-transparent text-base outline-none disabled:opacity-60"
        />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <label htmlFor="deck-style" className="text-muted text-xs">
              Citations
            </label>
            <select
              id="deck-style"
              value={style}
              onChange={(e) => setStyle(e.target.value as CitationStyle)}
              disabled={busy}
              className="border-line bg-surface-2 text-ink rounded-full border px-3 py-1 text-xs"
            >
              {MANUSCRIPT_STYLES.map((option) => (
                <option key={option} value={option}>
                  {option.toUpperCase()}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-3">
            <CostHint feature="deck_outline" />
            <button
              type="button"
              onClick={build}
              disabled={busy || !topic.trim()}
              className="bg-accent-solid text-accent-ink hover:bg-accent-solid-hover rounded-full px-5 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? "Building…" : "Build deck"}
            </button>
          </div>
        </div>
      </div>

      {busy && (
        <p className="text-muted text-sm" aria-live="polite">
          Searching for papers, then outlining what they say. This runs a search across nine sources
          and one long generation, so it takes a while.
        </p>
      )}

      {state.status === "error" && (
        <p className="text-danger text-sm" role="alert">
          {state.message}
        </p>
      )}

      {state.status === "built" && (
        <BuiltDeck deck={state.deck} copied={copied} onCopy={copyMarkdown} />
      )}
    </div>
  );
}

function BuiltDeck({
  deck,
  copied,
  onCopy,
}: {
  deck: DeckResponse;
  copied: boolean;
  onCopy: (markdown: string) => void;
}) {
  const { outline } = deck;
  const dropped = outline.droppedUncited + outline.droppedForeign;
  // The one return a sponsor gets for donating the capacity that built this.
  const attribution = attributionLine(deck.sponsor);

  if (deck.empty) {
    return (
      <div className="border-line bg-surface rounded-2xl border p-4">
        <p className="text-ink text-sm">
          Every bullet that came back was uncited, so there is no deck to show.
        </p>
        <p className="text-muted mt-2 text-sm">
          Nothing was inserted rather than showing you claims none of the {deck.searched} papers
          support. A narrower topic usually gives the model something concrete to attribute.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-muted text-sm">
          {outline.slides.length} slides from {deck.sources.length} cited papers
          {dropped > 0 && ` · ${dropped} uncited claim${dropped === 1 ? "" : "s"} removed`}
          {attribution && ` · ${attribution}`}
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onCopy(deck.markdown)}
            className="border-line bg-surface text-ink hover:border-accent hover:text-accent rounded-full border px-4 py-1.5 text-xs transition-colors"
          >
            {copied ? "Copied" : "Copy Markdown"}
          </button>
        </div>
      </div>

      <ol className="flex flex-col gap-3">
        {outline.slides.map((slide, index) => (
          <li key={index} className="border-line bg-surface rounded-2xl border p-4">
            <p className="text-muted text-[11px] tracking-wide uppercase">Slide {index + 1}</p>
            <h2 className="text-ink mt-1 text-base font-semibold">{slide.title}</h2>
            <ul className="mt-2 flex flex-col gap-1.5">
              {slide.bullets.map((bullet, bulletIndex) => (
                <li key={bulletIndex} className="text-ink text-sm leading-relaxed">
                  {bulletSegments(bullet).map((segment, segmentIndex) =>
                    segment.kind === "text" ? (
                      <span key={segmentIndex}>{segment.value}</span>
                    ) : (
                      <sup key={segmentIndex} className="text-link ml-0.5">
                        [{citationNumber(deck, segment.workKey)}]
                      </sup>
                    ),
                  )}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>

      <div className="border-line bg-surface rounded-2xl border p-4">
        <h2 className="text-ink text-sm font-semibold">Sources</h2>
        <ol className="mt-2 flex flex-col gap-1.5">
          {deck.sources.map((source, index) => (
            <li key={source.workKey} className="text-muted text-sm">
              <span className="text-muted mr-1">[{index + 1}]</span>
              {source.landingPageUrl ? (
                <Link
                  href={source.landingPageUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-link hover:underline"
                >
                  {source.title}
                </Link>
              ) : (
                <span className="text-ink">{source.title}</span>
              )}
              {source.year != null && ` (${source.year})`}
            </li>
          ))}
        </ol>
        <p className="text-muted mt-3 text-xs">
          The Markdown export is a{" "}
          <Link
            href="https://marp.app"
            target="_blank"
            rel="noreferrer"
            className="text-link hover:underline"
          >
            Marp
          </Link>{" "}
          deck: it renders as slides in VS Code and converts to PDF or PPTX from the command line.
        </p>
      </div>
    </div>
  );
}

/** The number shown against a bullet is the source's position in the list
 * below it, so the two always agree — the same first-appearance ordering the
 * exported reference slide uses. */
function citationNumber(deck: DeckResponse, workKey: string): number | string {
  const index = deck.sources.findIndex((source) => source.workKey === workKey);
  return index < 0 ? "?" : index + 1;
}
