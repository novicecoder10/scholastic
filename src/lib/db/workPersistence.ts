import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { work } from "@/lib/db/schema";
import { normalizeTitle } from "@/lib/merge/normalize";
import type { CanonicalWork } from "@/lib/types/work";
import { logger } from "@/lib/log/logger";

const ABSTRACT_JACCARD_THRESHOLD = 0.3;
const ABSTRACT_COMPARISON_LENGTH = 1000;

function wordSet(text: string): Set<string> {
  return new Set(
    normalizeTitle(text.slice(0, ABSTRACT_COMPARISON_LENGTH)).split(/\s+/).filter(Boolean),
  );
}

/**
 * Pure decision extracted from the DB IO so it's unit-testable without a live
 * database. A hash-based workKey collision guard needs a signal NOT already
 * baked into the key itself — title/year/first-author-surname/venue are the
 * hash's own inputs, so two works sharing a key are *guaranteed* to already
 * have identical normalized titles; comparing those again proves nothing.
 * Abstract text is the one substantive field left that isn't part of the key,
 * so it's the actual discriminating signal: if both works report an abstract
 * and they're substantially dissimilar, that's real evidence of two different
 * papers coincidentally sharing a key. If either is missing, there's no
 * further signal available — treat it as the same work, consistent with this
 * codebase's general bias toward under-flagging over false positives (see the
 * fuzzy dedup matcher's own precision-over-recall stance).
 *
 * Word-level Jaccard overlap, not Jaro-Winkler: JW is a character-level metric
 * calibrated for short strings (names, titles) — on paragraph-length text its
 * matching window scales up with string length and scores unrelated abstracts
 * as deceptively similar. Jaccard over word sets is the appropriate tool here.
 */
export function isLikelySameWork(
  existing: { abstract: string | null },
  incoming: { abstract: string | null },
): boolean {
  if (!existing.abstract || !incoming.abstract) return true;
  const a = wordSet(existing.abstract);
  const b = wordSet(incoming.abstract);
  if (a.size === 0 || b.size === 0) return true;

  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection++;
  const union = a.size + b.size - intersection;
  return intersection / union >= ABSTRACT_JACCARD_THRESHOLD;
}

async function upsertOne(canonicalWork: CanonicalWork): Promise<void> {
  const { workKey } = canonicalWork;
  const db = getDb();

  const values = {
    workKey,
    doi: canonicalWork.doi,
    title: canonicalWork.title,
    abstract: canonicalWork.abstract,
    year: canonicalWork.year,
    venue: canonicalWork.venue,
    authors: canonicalWork.authors,
    citationCount: canonicalWork.citationCount,
    isOpenAccess: canonicalWork.isOpenAccess,
    pdfUrl: canonicalWork.pdfUrl,
    landingPageUrl: canonicalWork.landingPageUrl,
    sources: canonicalWork.sources,
    lastSeenAt: new Date(),
  };

  // DOIs are globally unique identifiers — a DOI-keyed conflict is always the
  // same paper, safe to overwrite unconditionally.
  if (workKey.startsWith("doi:")) {
    await db.insert(work).values(values).onConflictDoUpdate({ target: work.workKey, set: values });
    return;
  }

  // Hash-based key: two distinct DOI-less papers could in principle collide
  // (see getWorkKey's doc comment) — guard against silently overwriting a
  // different paper's persisted record before updating.
  const existing = await db.select().from(work).where(eq(work.workKey, workKey)).limit(1);
  const existingRow = existing[0];

  if (!existingRow) {
    await db.insert(work).values(values).onConflictDoNothing();
    return;
  }

  if (!isLikelySameWork(existingRow, canonicalWork)) {
    logger.warn(
      {
        event: "work_key_collision",
        workKey,
        existingTitle: existingRow.title,
        incomingTitle: canonicalWork.title,
      },
      "workKey collision between two dissimilar abstracts — skipping upsert to avoid overwriting a different paper",
    );
    return;
  }

  await db.update(work).set(values).where(eq(work.workKey, workKey));
}

/**
 * Fire-and-forget: persisting search results must never affect the request
 * that triggered it (same pattern as `persistHealthSnapshot`/search cache
 * writes). Populates the `work` table — previously defined but never written
 * to — which is the stable substrate every AI feature (embeddings, summaries,
 * citation enrichment) references by `workKey`.
 */
export function persistWorks(works: CanonicalWork[]): void {
  for (const canonicalWork of works) {
    upsertOne(canonicalWork).catch((err: unknown) => {
      logger.warn(
        { event: "work_persist_failed", title: canonicalWork.title, err: String(err) },
        "failed to persist work",
      );
    });
  }
}
