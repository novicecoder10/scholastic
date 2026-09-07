import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { savedItem, work } from "@/lib/db/schema";
import type { CanonicalWork } from "@/lib/types/work";
import { logger } from "@/lib/log/logger";

/**
 * Turns the workKeys in a manuscript into works that can be formatted.
 *
 * The order matters and is not arbitrary:
 *
 * 1. **#5's `saved_item.workSnapshot`.** That column exists precisely because
 *    `persistWorks` is un-awaited best-effort, so the `work` row may be stale or
 *    missing. A manuscript is exactly the consumer that cannot tolerate a
 *    bibliography entry changing under it because a provider revised its
 *    metadata.
 * 2. **The `work` table**, for anything cited but never saved.
 *
 * A key that resolves to nothing maps to `null` and is rendered as a visible
 * broken-citation marker. It is never dropped: a citation that disappears
 * leaves the claim standing without its attribution.
 *
 * A live provider lookup is a deliberate third tier that is not implemented
 * here — every path into a manuscript goes through a search or a library, both
 * of which persist, so the case is theoretical today and a network call per
 * unresolved key on every render is not a cost to pay for it.
 */
export async function resolveWorks(
  userId: string,
  workKeys: string[],
): Promise<Map<string, CanonicalWork | null>> {
  const resolved = new Map<string, CanonicalWork | null>(workKeys.map((key) => [key, null]));
  if (workKeys.length === 0) return resolved;

  try {
    const snapshots = await getDb()
      .select({ workKey: savedItem.workKey, snapshot: savedItem.workSnapshot })
      .from(savedItem)
      .where(and(eq(savedItem.userId, userId), inArray(savedItem.workKey, workKeys)));

    for (const row of snapshots) {
      if (row.workKey && row.snapshot) resolved.set(row.workKey, row.snapshot as CanonicalWork);
    }

    const unresolved = workKeys.filter((key) => !resolved.get(key));
    if (unresolved.length === 0) return resolved;

    const rows = await getDb().select().from(work).where(inArray(work.workKey, unresolved));
    for (const row of rows) {
      resolved.set(row.workKey, {
        id: String(row.id),
        workKey: row.workKey,
        doi: row.doi,
        title: row.title,
        abstract: row.abstract,
        authors: row.authors,
        year: row.year,
        venue: row.venue,
        citationCount: row.citationCount,
        isOpenAccess: row.isOpenAccess ?? false,
        pdfUrl: row.pdfUrl,
        landingPageUrl: row.landingPageUrl,
        sources: row.sources.map((s) => ({
          sourceId: s.sourceId,
          sourceRecordId: s.sourceRecordId,
          citationCount: null,
        })),
        // The `work` table predates #4's citation-grade block, so a work known
        // only from here formats with an explicit "incomplete" note rather than
        // an invented volume.
        bibliographic: null,
        topics: [],
        score: 0,
      });
    }
  } catch (err) {
    // A bibliography that fails to resolve renders as broken markers, which is
    // visible and honest. Taking the editor down over it is not.
    logger.warn({ event: "manuscript_resolve_failed", err: String(err) }, "work resolve degraded");
  }

  return resolved;
}
