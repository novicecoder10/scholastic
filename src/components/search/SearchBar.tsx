"use client";

import {
  useId,
  useState,
  useTransition,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import type { SearchMode } from "@/lib/types/search";

type SearchBarVariant = "hero" | "compact";

/** What the caller-supplied action row (homepage quick actions) can drive. */
export interface SearchBarActionApi {
  value: string;
  pending: boolean;
  /** Runs the same understanding + navigation flow as the submit button,
   * optionally landing on a different view of the results (e.g. synthesis). */
  run: (options?: { view?: string }) => void;
}

interface SearchBarProps {
  initialQuery: string;
  initialMode: SearchMode;
  variant?: SearchBarVariant;
  placeholder?: string;
  renderActions?: (api: SearchBarActionApi) => ReactNode;
}

interface PriorTurn {
  question: string;
  answer: string;
}

type UnderstandingResult =
  { action: "search"; query: string; mode: SearchMode } | { action: "clarify"; question: string };

function navigateToSearch(
  router: ReturnType<typeof useRouter>,
  query: string,
  mode: SearchMode,
  view?: string,
) {
  const params = new URLSearchParams({ q: query });
  if (mode === "semantic") params.set("mode", "semantic");
  if (view) params.set("view", view);
  router.push(`/?${params.toString()}`, { scroll: false });
}

export function SearchBar({
  initialQuery,
  initialMode,
  variant = "hero",
  placeholder,
  renderActions,
}: SearchBarProps) {
  const [value, setValue] = useState(initialQuery);
  const [mode, setMode] = useState<SearchMode>(initialMode);
  const [understanding, setUnderstanding] = useState(false);
  const [clarify, setClarify] = useState<{
    question: string;
    originalInput: string;
    priorTurns: PriorTurn[];
  } | null>(null);
  const router = useRouter();
  const inputId = useId();
  const isHero = variant === "hero";

  // The results page is a Server Component that fans out to nine providers, so
  // router.push() doesn't commit until that render returns — often 10s+. Driving
  // it through a transition keeps isNavigating true for that whole window;
  // without it the pending state would clear the moment push() was called and
  // the UI would look frozen. loading.tsx can't cover this: its fallback only
  // shows for a prefetched route, and a programmatic push never prefetches.
  const [isNavigating, startTransition] = useTransition();
  const pending = understanding || isNavigating;

  function goToResults(query: string, nextMode: SearchMode, view?: string) {
    startTransition(() => navigateToSearch(router, query, nextMode, view));
  }

  async function runSearch(view?: string) {
    const trimmed = value.trim();
    if (!trimmed || pending) return;

    const isAnswerToClarify = clarify !== null;
    const originalInput = isAnswerToClarify ? clarify.originalInput : trimmed;
    const priorTurns = isAnswerToClarify
      ? [...clarify.priorTurns, { question: clarify.question, answer: trimmed }]
      : [];

    setUnderstanding(true);
    try {
      const response = await fetch("/api/query-understanding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: originalInput, priorTurns }),
      });

      if (!response.ok) {
        // Query understanding itself is unreachable — degrade to a literal
        // navigation with whatever the user actually typed, same fallback
        // contract as understandQuery()'s own internal degradation.
        goToResults(trimmed, mode, view);
        return;
      }

      const result = (await response.json()) as UnderstandingResult;
      if (result.action === "clarify") {
        setClarify({ question: result.question, originalInput, priorTurns });
        setValue("");
        return;
      }

      setClarify(null);
      setMode(result.mode);
      goToResults(result.query, result.mode, view);
    } catch {
      goToResults(trimmed, mode, view);
    } finally {
      setUnderstanding(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void runSearch();
  }

  function handleHeroKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void runSearch();
    }
  }

  function handleSkipClarify() {
    if (!clarify) return;
    goToResults(clarify.originalInput, mode);
    setClarify(null);
  }

  const inputLabel = clarify
    ? clarify.question
    : "Search papers across OpenAlex, Semantic Scholar, Crossref, PubMed, arXiv, CORE, Europe PMC, DOAJ, and Unpaywall";

  const resolvedPlaceholder = clarify
    ? "Your answer…"
    : (placeholder ??
      (mode === "semantic"
        ? "Describe what you're looking for…"
        : "Search papers, topics, or authors…"));

  const clarifyNotice = clarify && (
    <div
      className="border-line bg-surface-2 text-ink rounded-xl border px-4 py-3 text-sm"
      aria-live="polite"
    >
      <p>{clarify.question}</p>
      <button
        type="button"
        onClick={handleSkipClarify}
        className="text-link mt-1 text-xs font-medium underline hover:no-underline"
      >
        Skip and search &quot;{clarify.originalInput}&quot; anyway
      </button>
    </div>
  );

  if (!isHero) {
    return (
      <form role="search" onSubmit={handleSubmit} className="flex w-full flex-col gap-2">
        <div className="border-line bg-surface focus-within:border-accent flex w-full items-center gap-2 rounded-full border px-3 py-1.5">
          <label htmlFor={inputId} className="sr-only">
            {inputLabel}
          </label>
          <input
            id={inputId}
            name="q"
            type="search"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={resolvedPlaceholder}
            disabled={pending}
            className="text-ink placeholder:text-muted min-w-0 flex-1 bg-transparent text-sm outline-none disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={pending}
            className="text-muted hover:text-ink shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors disabled:cursor-wait"
          >
            {understanding ? "Thinking…" : isNavigating ? "Searching…" : "Search"}
          </button>
        </div>
        {clarifyNotice}
      </form>
    );
  }

  return (
    <form role="search" onSubmit={handleSubmit} className="flex w-full flex-col gap-3">
      {clarifyNotice}

      <div className="border-line bg-surface focus-within:border-accent rounded-2xl border p-3 shadow-[0_1px_0_0_rgba(255,255,255,0.03)_inset] transition-colors">
        <label htmlFor={inputId} className="sr-only">
          {inputLabel}
        </label>
        <textarea
          id={inputId}
          name="q"
          rows={2}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleHeroKeyDown}
          placeholder={resolvedPlaceholder}
          disabled={pending}
          className="text-ink placeholder:text-muted w-full resize-none bg-transparent px-2 py-1 text-base outline-none disabled:opacity-60"
        />

        <div className="mt-1 flex flex-wrap items-center justify-between gap-2 px-1">
          <div className="flex items-center gap-2">
            <fieldset className="flex items-center gap-1">
              <legend className="sr-only">Search mode</legend>
              {(
                [
                  { id: "keyword", label: "Keyword" },
                  { id: "semantic", label: "Semantic" },
                ] as const
              ).map((option) => (
                <label
                  key={option.id}
                  className={`cursor-pointer rounded-full px-3 py-1 text-xs transition-colors ${
                    mode === option.id ? "bg-surface-2 text-ink" : "text-muted hover:text-ink"
                  }`}
                >
                  <input
                    type="radio"
                    name="mode"
                    value={option.id}
                    checked={mode === option.id}
                    onChange={() => setMode(option.id)}
                    className="sr-only"
                  />
                  {option.label}
                </label>
              ))}
            </fieldset>
          </div>

          <button
            type="submit"
            disabled={pending || !value.trim()}
            className="bg-accent-solid text-accent-ink hover:bg-accent-solid-hover rounded-full px-5 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50"
          >
            {understanding ? "Thinking…" : isNavigating ? "Searching…" : "Search"}
          </button>
        </div>
      </div>

      <p className="text-muted px-1 text-xs">Enter to search · Shift+Enter for a new line</p>

      {renderActions?.({
        value,
        pending,
        run: (options) => void runSearch(options?.view),
      })}
    </form>
  );
}
