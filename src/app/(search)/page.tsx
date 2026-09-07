import type { Metadata } from "next";
import { performSearch } from "@/lib/search";
import { verifySession } from "@/lib/auth/dal";
import { savedWorkKeys } from "@/lib/library/repository";
import { logger } from "@/lib/log/logger";
import { HomeHero } from "@/components/home/HomeHero";
import { SearchExperience } from "@/components/search/SearchExperience";
import type { SearchMode } from "@/lib/types/search";

interface PageProps {
  searchParams: Promise<{ q?: string; mode?: string; view?: string }>;
}

function parseMode(mode: string | undefined): SearchMode {
  return mode === "semantic" ? "semantic" : "keyword";
}

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const { q, mode } = await searchParams;
  const query = q?.trim();
  if (!query) return {};

  const searchMode = parseMode(mode);
  const canonicalParams = new URLSearchParams({ q: query });
  if (searchMode === "semantic") canonicalParams.set("mode", "semantic");

  return {
    title: query,
    description: `Search results for "${query}" across OpenAlex, Semantic Scholar, Crossref, PubMed, arXiv, CORE, Europe PMC, DOAJ, and Unpaywall.`,
    alternates: { canonical: `/?${canonicalParams.toString()}` },
  };
}

export default async function HomePage({ searchParams }: PageProps) {
  const { q, mode, view } = await searchParams;
  const query = q?.trim();
  const searchMode = parseMode(mode);
  const response = query ? await performSearch({ q: query, mode: searchMode }) : null;

  // Which of these results the signed-in user has already saved, so a card
  // renders "Saved ✓" on arrival rather than offering to save something that is
  // already in the library. One query for the whole page, not one per card.
  // Degrades like every other database-backed path here: a failure means the
  // buttons start unsaved, never that the results page fails to render.
  let saved: string[] = [];
  if (response) {
    const user = await verifySession();
    if (user) {
      try {
        saved = [...(await savedWorkKeys(user.id, response.results.map((w) => w.workKey)))];
      } catch (err) {
        logger.warn({ event: "saved_keys_lookup_failed", err: String(err) }, "saved lookup failed");
      }
    }
  }

  if (!response) {
    return (
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col items-center justify-center px-4 py-16 sm:px-8">
        <HomeHero initialMode={searchMode} />
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-8 sm:px-8">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-ink text-lg font-semibold tracking-tight">{query}</h1>
        <span className="text-muted text-xs">
          {searchMode === "semantic" ? "Semantic search" : "Keyword search"}
        </span>
      </div>
      <SearchExperience
        response={response}
        openSynthesis={view === "review"}
        savedWorkKeys={saved}
      />
    </main>
  );
}
