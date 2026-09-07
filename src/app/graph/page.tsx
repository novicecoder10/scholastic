import type { Metadata } from "next";
import Link from "next/link";
import { GraphExplorer } from "@/components/graph/GraphExplorer";
import { readOwner } from "@/lib/auth/owner";
import { verifySession } from "@/lib/auth/dal";
import { findCollection, listCollectionItems, listSavedItems } from "@/lib/library/repository";
import { performSearch } from "@/lib/search";
import { getDb } from "@/lib/db/client";
import { work } from "@/lib/db/schema";
import { eq, inArray } from "drizzle-orm";
import type { SeedRoot } from "@/lib/graph/build";
import type { CanonicalWork } from "@/lib/types/work";
import { logger } from "@/lib/log/logger";

export const metadata: Metadata = { title: "Citation graph" };
export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ work?: string; collection?: string; from?: string; q?: string }>;
}

/**
 * Three ways in, one explorer.
 *
 * The multi-root form is where the value is: seeing that four of twenty results
 * all cite the same 1998 paper is a fact about a literature that no single-root
 * graph can show.
 */
export default async function GraphPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const owner = await readOwner();
  const user = await verifySession();

  let seeds: SeedRoot[] = [];
  let heading = "Citation graph";
  let subheading: string | null = null;

  try {
    if (params.work) {
      seeds = await seedsFromWorkKeys([params.work]);
      heading = seeds[0]?.title ?? "Citation graph";
      subheading = "Expanding from one paper.";
    } else if (params.collection && user) {
      const collection = await findCollection(user.id, params.collection);
      if (collection) {
        const items = await listCollectionItems(collection.id);
        seeds = items
          .map((item) => item.workSnapshot as CanonicalWork | null)
          .filter((w): w is CanonicalWork => Boolean(w))
          .map(toSeed);
        heading = collection.name;
        subheading = `${seeds.length} papers from this collection, with the citations between them.`;
      }
    } else if (params.from === "search" && params.q) {
      const response = await performSearch({ q: params.q, perPage: 20 });
      seeds = response.results.map(toSeed);
      heading = params.q;
      subheading = `${seeds.length} results, with the citations between them.`;
    } else if (user) {
      // Reaching the explorer from the navbar used to land on an explainer with
      // no way forward, which is a dead end wearing a nav item. A signed-in
      // researcher already has the best possible seed set sitting in their
      // library, and the multi-root view of it is the thing worth showing.
      const saved = await listSavedItems(user.id, "work");
      seeds = saved
        .map((item) => item.workSnapshot as CanonicalWork | null)
        .filter((w): w is CanonicalWork => Boolean(w))
        .slice(0, 20)
        .map(toSeed);
      if (seeds.length > 0) {
        heading = "Your library";
        subheading = `${seeds.length} saved papers, with the citations between them.`;
      }
    }
  } catch (err) {
    logger.warn({ event: "graph_seed_failed", err: String(err) }, "graph seeding degraded");
  }

  let libraryKeys: string[] = [];
  if (user) {
    try {
      libraryKeys = (await listSavedItems(user.id, "work"))
        .map((item) => item.workKey)
        .filter((key): key is string => Boolean(key));
    } catch {
      // A missing library marker is cosmetic; the graph still works.
    }
  }

  if (seeds.length === 0) {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-8">
        <h1 className="text-ink text-2xl font-semibold tracking-tight">Citation map</h1>
        <p className="text-muted mt-2 mb-6 text-sm">
          Seeded from several papers at once, the edges between them are what show a shared
          ancestor — four results citing the same 1998 paper is a fact about a literature that no
          single-paper graph can tell you.
        </p>

        {/* A plain GET form: the explorer is a URL, so seeding it needs no
            client state and works before any JavaScript loads. */}
        <form action="/graph" method="get" className="flex flex-col gap-3">
          <input type="hidden" name="from" value="search" />
          <label htmlFor="graph-q" className="text-muted text-xs font-medium">
            Map the literature on
          </label>
          <div className="border-line bg-surface focus-within:border-accent flex items-center gap-2 rounded-full border px-4 py-2">
            <input
              id="graph-q"
              name="q"
              type="search"
              required
              placeholder="e.g. CRISPR off-target effects"
              className="text-ink placeholder:text-muted min-w-0 flex-1 bg-transparent text-sm outline-none"
            />
            <button
              type="submit"
              className="bg-accent-solid text-accent-ink hover:bg-accent-solid-hover shrink-0 rounded-full px-4 py-1.5 text-xs font-medium transition-colors"
            >
              Build map
            </button>
          </div>
        </form>

        <p className="text-muted mt-6 text-sm">
          {user ? (
            <>
              You can also open it from a result card, from a collection, or{" "}
              <Link href="/library" className="text-link hover:underline">
                save some papers
              </Link>{" "}
              — a library of saved work seeds this page on its own.
            </>
          ) : (
            <>
              You can also open it from any result card&apos;s citation graph, or from a{" "}
              <Link href="/library" className="text-link hover:underline">
                collection
              </Link>
              .
            </>
          )}
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-8">
      <h1 className="text-ink text-lg font-semibold tracking-tight">{heading}</h1>
      {subheading && <p className="text-muted mt-1 mb-4 text-sm">{subheading}</p>}
      <GraphExplorer seeds={seeds} libraryKeys={libraryKeys} anonymous={!owner} />
    </main>
  );
}

function toSeed(work: CanonicalWork): SeedRoot {
  return { workKey: work.workKey, title: work.title, doi: work.doi, year: work.year };
}

/** A single `?work=` seed is looked up in the `work` table, which every search
 * populates. A key we have never seen still seeds the graph — with its own key
 * as its label — rather than rendering an empty page. */
async function seedsFromWorkKeys(workKeys: string[]): Promise<SeedRoot[]> {
  const rows = await getDb()
    .select({ workKey: work.workKey, title: work.title, doi: work.doi, year: work.year })
    .from(work)
    .where(workKeys.length === 1 ? eq(work.workKey, workKeys[0]) : inArray(work.workKey, workKeys));

  const found = new Map(rows.map((row) => [row.workKey, row]));
  return workKeys.map(
    (key) =>
      found.get(key) ?? { workKey: key, title: key.replace(/^doi:/, ""), doi: doiFrom(key), year: null },
  );
}

function doiFrom(workKey: string): string | null {
  return workKey.startsWith("doi:") ? workKey.slice(4) : null;
}
