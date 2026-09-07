import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { citationCache, work } from "@/lib/db/schema";
import {
  getOpenCitationsCitingWorks,
  getOpenCitationsReferences,
} from "@/lib/ai/citations/opencitations";
import {
  getSemanticScholarCitingWorks,
  getSemanticScholarReferences,
} from "@/lib/providers/semanticscholar/citations";
import { normalizeDoi } from "@/lib/merge/normalize";
import { getWorkKey } from "@/lib/ai/workKey";
import { WorkNotFoundError } from "@/lib/ai/errors";
import type { CitationEdges, CitationRef } from "@/lib/ai/citations/types";
import { logger } from "@/lib/log/logger";

/** Citation counts/citing-lists change over time (unlike an abstract) —
 * unlike the summary cache, this one expires. Weeks-scale, same spirit as
 * SEARCH_CACHE_TTL_MS being minutes-scale for the much-more-volatile search
 * result set. */
const CITATION_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

type CitationSource = "opencitations" | "semantic_scholar";

export interface CitationEnrichmentResult extends CitationEdges {
  sources: CitationSource[];
  degraded: boolean;
}

/** Exported for direct unit testing — pure dedup logic, no DB/network. */
export function mergeCitationRefs(lists: CitationRef[][]): CitationRef[] {
  const byDoi = new Map<string, CitationRef>();
  const noDoi: CitationRef[] = [];

  for (const list of lists) {
    for (const ref of list) {
      const doi = normalizeDoi(ref.doi);
      if (!doi) {
        noDoi.push(ref);
        continue;
      }
      const existing = byDoi.get(doi);
      // Prefer whichever source's entry has a title (richer data) on a duplicate.
      if (!existing || (!existing.title && ref.title)) byDoi.set(doi, ref);
    }
  }

  return [...byDoi.values(), ...noDoi];
}

async function getFromCacheOrFetch(
  workKey: string,
  source: CitationSource,
  fetcher: () => Promise<CitationEdges>,
): Promise<CitationEdges | null> {
  let db: ReturnType<typeof getDb> | null = null;
  try {
    db = getDb();
  } catch (err) {
    logger.warn(
      { event: "citation_cache_unavailable", workKey, source, err: String(err) },
      "citation cache DB unavailable, fetching without cache",
    );
  }

  if (db) {
    try {
      const rows = await db
        .select()
        .from(citationCache)
        .where(and(eq(citationCache.workKey, workKey), eq(citationCache.source, source)))
        .limit(1);
      const row = rows[0];
      if (row && Date.now() - row.fetchedAt.getTime() < CITATION_CACHE_TTL_MS) {
        return row.payload as CitationEdges;
      }
    } catch (err) {
      logger.warn(
        { event: "citation_cache_read_failed", workKey, source, err: String(err) },
        "citation cache DB read failed",
      );
    }
  }

  let result: CitationEdges;
  try {
    result = await fetcher();
  } catch (err) {
    logger.warn(
      { event: "citation_fetch_failed", workKey, source, err: String(err) },
      `${source} citation fetch failed`,
    );
    return null;
  }

  if (db) {
    try {
      await db
        .insert(citationCache)
        .values({ workKey, source, payload: result })
        .onConflictDoUpdate({
          target: [citationCache.workKey, citationCache.source],
          set: { payload: result, fetchedAt: new Date() },
        });
    } catch (err) {
      // A cache-write failure must never affect the response — the freshly
      // fetched result above is still returned to the caller.
      logger.warn(
        { event: "citation_cache_write_failed", workKey, source, err: String(err) },
        "citation cache DB write failed",
      );
    }
  }

  return result;
}

/**
 * Core by-DOI enrichment — usable for a persisted work (via the wrapper below)
 * or a citation-graph expansion node that was never itself searched for (no
 * `work` row exists). The cache key is derived via `getWorkKey()`'s DOI
 * branch — the same function (and thus the same key) a persisted work would
 * get if it were later searched for directly, so an expansion node's cache
 * entry and a later "actually searched" row converge on one cache row rather
 * than duplicating.
 */
export async function getCitationEnrichmentByDoi(doi: string): Promise<CitationEnrichmentResult> {
  const workKey = getWorkKey({ doi, title: "", year: null, authors: [], venue: null });

  const [openCitationsResult, semanticScholarResult] = await Promise.all([
    getFromCacheOrFetch(workKey, "opencitations", async () => ({
      citing: await getOpenCitationsCitingWorks(doi),
      cited: await getOpenCitationsReferences(doi),
    })),
    getFromCacheOrFetch(workKey, "semantic_scholar", async () => ({
      citing: await getSemanticScholarCitingWorks(doi),
      cited: await getSemanticScholarReferences(doi),
    })),
  ]);

  const sources: CitationSource[] = [];
  const citingLists: CitationRef[][] = [];
  const citedLists: CitationRef[][] = [];

  if (openCitationsResult) {
    sources.push("opencitations");
    citingLists.push(openCitationsResult.citing);
    citedLists.push(openCitationsResult.cited);
  }
  if (semanticScholarResult) {
    sources.push("semantic_scholar");
    citingLists.push(semanticScholarResult.citing);
    citedLists.push(semanticScholarResult.cited);
  }

  return {
    citing: mergeCitationRefs(citingLists),
    cited: mergeCitationRefs(citedLists),
    sources,
    degraded: sources.length < 2,
  };
}

/**
 * Both citation data sources are by-DOI only, so a work without a DOI simply
 * can't be enriched — reported as `degraded: true` with empty results rather
 * than an error, since "no DOI" is a normal, expected state for many
 * DOI-less preprints/records, not a failure. Thin wrapper: looks up the
 * persisted work's DOI, then delegates to the DOI-keyed core above.
 */
export async function getCitationEnrichment(workKey: string): Promise<CitationEnrichmentResult> {
  const db = getDb();
  const workRows = await db.select().from(work).where(eq(work.workKey, workKey)).limit(1);
  const workRow = workRows[0];
  if (!workRow) throw new WorkNotFoundError(workKey);

  if (!workRow.doi) {
    return { citing: [], cited: [], sources: [], degraded: true };
  }

  return getCitationEnrichmentByDoi(workRow.doi);
}
