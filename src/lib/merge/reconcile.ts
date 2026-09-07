import type { BibliographicDetail, RawWork, RawWorkTopic } from "@/lib/providers/types";
import type { CanonicalWork, CanonicalWorkSource } from "@/lib/types/work";
import { normalizeDoi } from "@/lib/merge/normalize";
import { getWorkKey } from "@/lib/ai/workKey";

/**
 * Sources preferred for "published version" style fields (title, venue, year
 * tie-breaks) over preprint servers, whose metadata is sometimes less complete
 * or retains submission-draft artifacts (e.g. LaTeX remnants in titles).
 */
const PUBLISHED_SOURCE_PRIORITY = ["crossref", "openalex", "europepmc", "pubmed", "doaj"];

function sourcePriorityRank(sourceId: string): number {
  const idx = PUBLISHED_SOURCE_PRIORITY.indexOf(sourceId);
  return idx === -1 ? PUBLISHED_SOURCE_PRIORITY.length : idx;
}

function pickLongest(values: (string | null)[]): string | null {
  let best: string | null = null;
  for (const v of values) {
    if (v && (best === null || v.length > best.length)) best = v;
  }
  return best;
}

function pickTitle(cluster: RawWork[]): string {
  const sorted = [...cluster].sort(
    (a, b) => sourcePriorityRank(a.sourceId) - sourcePriorityRank(b.sourceId),
  );
  const preferred = sorted.find((w) => w.title && w.title !== "Untitled");
  return preferred?.title ?? pickLongest(cluster.map((w) => w.title)) ?? "Untitled";
}

function pickDoi(cluster: RawWork[]): string | null {
  const dois = cluster.map((w) => normalizeDoi(w.doi)).filter((d): d is string => d !== null);
  if (dois.length === 0) return null;
  const crossrefWork = cluster.find((w) => w.sourceId === "crossref" && normalizeDoi(w.doi));
  return normalizeDoi(crossrefWork?.doi ?? null) ?? dois[0];
}

function pickAuthors(cluster: RawWork[]) {
  let best = cluster[0].authors;
  let bestOrcidCount = best.filter((a) => a.orcid).length;
  for (const w of cluster.slice(1)) {
    const orcidCount = w.authors.filter((a) => a.orcid).length;
    if (
      orcidCount > bestOrcidCount ||
      (orcidCount === bestOrcidCount && w.authors.length > best.length)
    ) {
      best = w.authors;
      bestOrcidCount = orcidCount;
    }
  }
  return best;
}

function pickYear(cluster: RawWork[]): number | null {
  const counts = new Map<number, number>();
  for (const w of cluster) {
    if (w.year == null) continue;
    counts.set(w.year, (counts.get(w.year) ?? 0) + 1);
  }
  if (counts.size === 0) return null;

  let bestYear: number | null = null;
  let bestCount = -1;
  let bestRank = Infinity;
  for (const [year, count] of counts) {
    const representativeWork = cluster.find((w) => w.year === year)!;
    const rank = sourcePriorityRank(representativeWork.sourceId);
    if (count > bestCount || (count === bestCount && rank < bestRank)) {
      bestYear = year;
      bestCount = count;
      bestRank = rank;
    }
  }
  return bestYear;
}

function pickVenue(cluster: RawWork[]): string | null {
  const sorted = [...cluster].sort(
    (a, b) => sourcePriorityRank(a.sourceId) - sourcePriorityRank(b.sourceId),
  );
  return sorted.find((w) => w.venue)?.venue ?? null;
}

function pickOpenAccess(cluster: RawWork[]): { isOpenAccess: boolean; pdfUrl: string | null } {
  const isOpenAccess = cluster.some((w) => w.isOpenAccess === true);
  const unpaywallWork = cluster.find((w) => w.sourceId === "unpaywall" && w.pdfUrl);
  const anyOaWithPdf = cluster.find((w) => w.isOpenAccess === true && w.pdfUrl);
  const anyPdf = cluster.find((w) => w.pdfUrl);
  const pdfUrl = unpaywallWork?.pdfUrl ?? anyOaWithPdf?.pdfUrl ?? anyPdf?.pdfUrl ?? null;
  return { isOpenAccess, pdfUrl };
}

/**
 * Picks the bibliographic block from the single highest-priority source in the
 * cluster that carries one — deliberately NOT field-by-field like every other
 * picker in this file.
 *
 * Volume, issue and page range are only meaningful together. A citation built
 * from OpenAlex's volume, PubMed's page range and Crossref's issue reads as
 * authoritative and can be wrong in a way no reader could detect, and there is
 * no plausible upside to trade against that. One source, or nothing.
 *
 * A block whose every field is null counts as absent: a source that returned a
 * record with no citation detail should not outrank a lower-priority source
 * that actually has some.
 */
export function pickBibliographic(cluster: RawWork[]): BibliographicDetail | null {
  const candidates = cluster
    .filter((w) => w.bibliographic && hasAnyDetail(w.bibliographic))
    .sort((a, b) => sourcePriorityRank(a.sourceId) - sourcePriorityRank(b.sourceId));
  return candidates[0]?.bibliographic ?? null;
}

function hasAnyDetail(detail: BibliographicDetail): boolean {
  return Object.values(detail).some((value) => value !== null && value !== undefined);
}

/** Union of every source's topics, keeping the highest score seen per name.
 * Only OpenAlex supplies these today, so in practice this dedupes a single
 * source's list; written as a union so a second supplier costs nothing. */
export function pickTopics(cluster: RawWork[]): RawWorkTopic[] {
  const byName = new Map<string, RawWorkTopic>();
  for (const work of cluster) {
    for (const topic of work.topics ?? []) {
      const existing = byName.get(topic.name);
      if (!existing || topic.score > existing.score) byName.set(topic.name, topic);
    }
  }
  return [...byName.values()].sort((a, b) => b.score - a.score);
}

function buildSourceRefs(cluster: RawWork[]): CanonicalWorkSource[] {
  return cluster.map((w) => ({
    sourceId: w.sourceId,
    sourceRecordId: w.sourceRecordId,
    citationCount: w.citationCount,
  }));
}

function buildId(cluster: RawWork[]): string {
  const doi = pickDoi(cluster);
  if (doi) return `doi:${doi}`;
  const first = cluster[0];
  return `${first.sourceId}:${first.sourceRecordId}`;
}

/**
 * Merges a cluster of RawWorks (all believed to be the same underlying paper,
 * per matcher.ts) into one canonical record. `score` is left at 0 — ranking
 * (lib/merge/rank.ts) is a separate, later pass over the full result set.
 */
export function reconcileCluster(cluster: RawWork[]): CanonicalWork {
  const { isOpenAccess, pdfUrl } = pickOpenAccess(cluster);
  const landingPageUrl = pickLongest(cluster.map((w) => w.landingPageUrl));
  const citationCounts = cluster.map((w) => w.citationCount).filter((c): c is number => c != null);
  const doi = pickDoi(cluster);
  const title = pickTitle(cluster);
  const authors = pickAuthors(cluster);
  const year = pickYear(cluster);
  const venue = pickVenue(cluster);

  return {
    id: buildId(cluster),
    // Stable across separate HTTP requests (unlike `id`, above) — computed
    // once here since doi/title/year/authors/venue are all frozen at this
    // point, so it never needs recomputing later (see lib/ai/workKey.ts).
    workKey: getWorkKey({ doi, title, year, authors, venue }),
    doi,
    title,
    abstract: pickLongest(cluster.map((w) => w.abstract)),
    authors,
    year,
    venue,
    citationCount: citationCounts.length > 0 ? Math.max(...citationCounts) : null,
    isOpenAccess,
    pdfUrl,
    landingPageUrl,
    sources: buildSourceRefs(cluster),
    bibliographic: pickBibliographic(cluster),
    topics: pickTopics(cluster),
    score: 0,
  };
}
