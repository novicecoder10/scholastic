"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { SearchBar, type SearchBarActionApi } from "@/components/search/SearchBar";
import type { SearchMode } from "@/lib/types/search";

function QuickAction({
  label,
  hint,
  disabled,
  busy,
  onClick,
}: {
  label: string;
  hint: string;
  disabled?: boolean;
  busy?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={hint}
      className="border-line bg-surface text-ink hover:border-accent hover:text-accent rounded-full border px-4 py-2 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50"
    >
      {busy ? "Opening…" : label}
    </button>
  );
}

/**
 * Five ways to start from one input. Every one of them runs the same query
 * against the same literature — the difference is the artifact you get back,
 * not the search.
 *
 * There is no "Draft" that writes prose from nothing and no "Diagrams" that
 * invents a figure: the two actions that sound like those are a manuscript
 * seeded with your topic, and the citation map of what the search found. A chip
 * that promised more than the app does would be the fastest way to make the
 * rest of it untrustworthy.
 */
function QuickActions({ value, pending, run }: SearchBarActionApi) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const query = value.trim();
  const ready = query.length > 0 && !pending && !creating;

  async function startManuscript() {
    setCreating(true);
    setError(null);
    try {
      const response = await fetch("/api/manuscripts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: query.slice(0, 200) }),
      });

      // The editor is the one feature that needs an account, so an anonymous
      // visitor is sent to sign in and returned here rather than told no.
      if (response.status === 401) {
        router.push(`/login?next=${encodeURIComponent("/write")}`);
        return;
      }

      const body = (await response.json().catch(() => null)) as {
        publicId?: string;
        error?: string;
      } | null;
      if (!response.ok || !body?.publicId) {
        setError(body?.error ?? "Couldn't start a manuscript right now.");
        return;
      }
      router.push(`/write/${body.publicId}`);
    } catch {
      setError("Couldn't reach the server to start a manuscript.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 px-1">
      <div className="flex flex-wrap items-center gap-2">
        <QuickAction
          label="Search papers"
          hint="Search nine open scholarly sources at once"
          disabled={!ready}
          onClick={() => run()}
        />
        <QuickAction
          label="Literature review"
          hint="Search, then open a synthesis chat across the whole result set"
          disabled={!ready}
          onClick={() => run({ view: "review" })}
        />
        <QuickAction
          label="Draft"
          hint="Start a manuscript on this topic, with live citations"
          disabled={!ready}
          busy={creating}
          onClick={() => void startManuscript()}
        />
        <QuickAction
          label="Citation map"
          hint="Graph the citations between the papers this query finds"
          disabled={!ready}
          onClick={() => router.push(`/graph?from=search&q=${encodeURIComponent(query)}`)}
        />
        <QuickAction
          label="Presentation"
          hint="Outline a slide deck from the literature, with a citation on every bullet"
          disabled={!ready}
          onClick={() => router.push(`/present?q=${encodeURIComponent(query)}`)}
        />
      </div>
      {error && (
        <p className="text-danger text-xs" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * The homepage's task-first entry point: one large input, the quick-action row
 * beneath it, and nothing else. Rendered only while no query is active — once a
 * search runs, the navbar's compact input takes over (see TopNav).
 */
export function HomeHero({ initialMode }: { initialMode: SearchMode }) {
  return (
    <div className="flex w-full max-w-2xl flex-col gap-5">
      <div className="flex flex-col gap-2">
        <h1 className="text-ink text-2xl font-semibold tracking-tight sm:text-3xl">
          What are you researching?
        </h1>
        <p className="text-muted text-sm">
          Ask in plain language or drop in keywords. Scholastic searches nine open scholarly sources
          at once, merges the duplicates, and ranks what comes back.
        </p>
      </div>

      <SearchBar
        initialQuery=""
        initialMode={initialMode}
        variant="hero"
        placeholder="e.g. how do transformer models handle long-range dependencies?"
        renderActions={(api) => <QuickActions {...api} />}
      />
    </div>
  );
}
