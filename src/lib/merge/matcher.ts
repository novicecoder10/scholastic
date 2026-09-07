import type { RawWork } from "@/lib/providers/types";
import { normalizeDoi, normalizeTitle, firstAuthorSurname } from "@/lib/merge/normalize";
import { jaroWinkler } from "@/lib/merge/jaroWinkler";

/**
 * Deliberately conservative: incorrectly merging two distinct papers is a worse
 * failure mode than occasionally leaving a true duplicate unmerged.
 */
export const FUZZY_TITLE_THRESHOLD = 0.92;
const YEAR_TOLERANCE = 1;

export function areFuzzyMatch(a: RawWork, b: RawWork): boolean {
  const authorA = firstAuthorSurname(a.authors);
  const authorB = firstAuthorSurname(b.authors);
  if (!authorA || !authorB || authorA !== authorB) return false;

  // Missing year on either side doesn't block a match (title+author already carry
  // most of the signal); when both are present, tolerate off-by-one to account for
  // preprint-vs-published-version year drift.
  if (a.year != null && b.year != null && Math.abs(a.year - b.year) > YEAR_TOLERANCE) {
    return false;
  }

  return jaroWinkler(normalizeTitle(a.title), normalizeTitle(b.title)) >= FUZZY_TITLE_THRESHOLD;
}

class UnionFind {
  private parent: number[];

  constructor(size: number) {
    this.parent = Array.from({ length: size }, (_, i) => i);
  }

  find(i: number): number {
    while (this.parent[i] !== i) {
      this.parent[i] = this.parent[this.parent[i]];
      i = this.parent[i];
    }
    return i;
  }

  union(i: number, j: number): void {
    const ri = this.find(i);
    const rj = this.find(j);
    if (ri !== rj) this.parent[ri] = rj;
  }
}

/**
 * Groups works from all providers into clusters that (probably) represent the
 * same underlying paper. DOI-exact matches are unioned first (cheap, O(n) via a
 * hash map); DOI-less works (e.g. arXiv preprints) are then fuzzy-matched against
 * *all* works — including ones already DOI-clustered — bucketed by first-author
 * surname to keep comparisons near-linear rather than O(n^2) across the whole
 * result set.
 */
export function clusterWorks(works: RawWork[]): RawWork[][] {
  const n = works.length;
  const uf = new UnionFind(n);

  const doiIndex = new Map<string, number[]>();
  works.forEach((w, i) => {
    const doi = normalizeDoi(w.doi);
    if (!doi) return;
    const list = doiIndex.get(doi) ?? [];
    list.push(i);
    doiIndex.set(doi, list);
  });
  for (const indices of doiIndex.values()) {
    for (let k = 1; k < indices.length; k++) uf.union(indices[0], indices[k]);
  }

  const authorBuckets = new Map<string, number[]>();
  works.forEach((w, i) => {
    const author = firstAuthorSurname(w.authors);
    if (!author) return;
    const list = authorBuckets.get(author) ?? [];
    list.push(i);
    authorBuckets.set(author, list);
  });

  works.forEach((w, i) => {
    if (normalizeDoi(w.doi)) return; // only DOI-less works need the fuzzy fallback
    const author = firstAuthorSurname(w.authors);
    if (!author) return;
    const candidates = authorBuckets.get(author) ?? [];
    for (const j of candidates) {
      if (j === i || uf.find(i) === uf.find(j)) continue;
      if (areFuzzyMatch(w, works[j])) uf.union(i, j);
    }
  });

  const groups = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const root = uf.find(i);
    const list = groups.get(root) ?? [];
    list.push(i);
    groups.set(root, list);
  }

  return Array.from(groups.values()).map((indices) => indices.map((i) => works[i]));
}
