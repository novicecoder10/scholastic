import type { CanonicalWork } from "@/lib/types/work";
import { normalizeTitle } from "@/lib/merge/normalize";

const CITATION_WEIGHT = 2.0;
const SOURCE_AGREEMENT_WEIGHT = 1.0;
const RECENCY_WEIGHT = 0.8;
const OPEN_ACCESS_BOOST = 0.3;
const RECENCY_DECAY_YEARS = 25;
const RELEVANCE_WEIGHT = 6.0;
const SIMILARITY_WEIGHT = 6.0;
/**
 * Minimum cosine similarity (against a normalized sentence embedding) for a
 * work to be considered a semantic-search candidate at all. Unlike keyword
 * mode's zero-token-overlap filter, this can't be zero — embedding similarity
 * is a continuous score with no natural "no relation whatsoever" cutoff — so
 * this is a heuristic threshold in the same spirit as the 0.92 Jaro-Winkler
 * fuzzy-dedup threshold: conservative-ish, tune later against real usage.
 */
export const MIN_SEMANTIC_SIMILARITY = 0.2;

const STOPWORDS = new Set([
  "a",
  "an",
  "the",
  "of",
  "in",
  "on",
  "for",
  "and",
  "or",
  "to",
  "is",
  "are",
  "with",
  "by",
  "at",
  "from",
  "as",
  "this",
  "that",
  "using",
]);

function tokenize(text: string): string[] {
  return normalizeTitle(text)
    .split(/\s+/)
    .filter((token) => token.length > 1 && !STOPWORDS.has(token));
}

/**
 * Fraction of distinct query tokens found anywhere in the work's text (title,
 * abstract, venue, author names), plus bonuses when a match lands in the
 * highest-signal fields (title, authors). A query with no tokens (empty/
 * stopwords-only) is treated as non-restrictive and scores neutrally.
 *
 * This exists because providers' own full-text search is loose (e.g. OpenAlex
 * returns some only-tangentially-related works for a two-word author-name
 * query) — without this, a high-citation but topically unrelated paper could
 * outrank an exact match purely on citation count. rankWorks() filters out
 * zero-relevance works entirely: a result sharing not one query term with a
 * work has no business surfacing it, regardless of citations.
 */
export function relevanceScore(query: string, work: CanonicalWork): number {
  const queryTokens = Array.from(new Set(tokenize(query)));
  if (queryTokens.length === 0) return 1;

  const titleTokens = new Set(tokenize(work.title));
  const authorTokens = new Set(work.authors.flatMap((a) => tokenize(a.name)));
  const otherTokens = new Set([...tokenize(work.abstract ?? ""), ...tokenize(work.venue ?? "")]);

  let coverage = 0;
  let titleCoverage = 0;
  let authorCoverage = 0;
  for (const token of queryTokens) {
    if (titleTokens.has(token)) {
      coverage++;
      titleCoverage++;
    } else if (authorTokens.has(token)) {
      coverage++;
      authorCoverage++;
    } else if (otherTokens.has(token)) {
      coverage++;
    }
  }

  return (
    coverage / queryTokens.length +
    titleCoverage / queryTokens.length +
    authorCoverage / queryTokens.length
  );
}

/**
 * The terms shared by both keyword and semantic scoring: log-scaled citation
 * count, cross-source agreement, recency, and open-access status. Extracted
 * so `scoreWork` (keyword) and `scoreWorkBySimilarity` (semantic) only differ
 * in their dominant term, not in how they break ties among works that are
 * comparably relevant/similar.
 */
function baseScore(work: CanonicalWork, now: Date): number {
  const citationScore = Math.log10((work.citationCount ?? 0) + 1);
  const agreementScore = work.sources.length;
  const recencyBoost =
    work.year != null ? Math.max(0, 1 - (now.getFullYear() - work.year) / RECENCY_DECAY_YEARS) : 0;
  const openAccessBoost = work.isOpenAccess ? OPEN_ACCESS_BOOST : 0;

  return (
    CITATION_WEIGHT * citationScore +
    SOURCE_AGREEMENT_WEIGHT * agreementScore +
    RECENCY_WEIGHT * recencyBoost +
    openAccessBoost
  );
}

/**
 * Simple, explainable weighted-sum score — not a learned or field-normalized
 * model. Query relevance is the dominant term (see relevanceScore); among
 * works of comparable relevance, log-scaled citation count, cross-source
 * agreement, recency, and open-access status break ties. See
 * KNOWN_LIMITATIONS.md for the v2 ranking target (BM25, field-normalized
 * citations).
 */
export function scoreWork(work: CanonicalWork, query: string, now: Date = new Date()): number {
  return RELEVANCE_WEIGHT * relevanceScore(query, work) + baseScore(work, now);
}

/**
 * Semantic-mode sibling of `scoreWork`: same tie-breaking terms, but the
 * dominant term is cosine similarity against a query embedding instead of
 * keyword-token overlap. `similarity` is computed by the caller (see
 * `lib/ai/similarity.ts` + `lib/ai/embeddings/`) since it depends on
 * embeddings, which this pure-scoring module has no reason to know about.
 */
export function scoreWorkBySimilarity(
  work: CanonicalWork,
  similarity: number,
  now: Date = new Date(),
): number {
  return SIMILARITY_WEIGHT * similarity + baseScore(work, now);
}

/**
 * Scores every work against the query and returns them sorted highest-scoring
 * first, dropping works that share zero terms with the query anywhere in
 * their title/abstract/venue/authors (see relevanceScore).
 */
export function rankWorks(
  works: CanonicalWork[],
  query: string,
  now: Date = new Date(),
): CanonicalWork[] {
  return works
    .filter((work) => relevanceScore(query, work) > 0)
    .map((work) => ({ ...work, score: scoreWork(work, query, now) }))
    .sort((a, b) => b.score - a.score);
}

/**
 * Semantic-mode sibling of `rankWorks`. `similarityByWorkId` maps each work's
 * response-scoped `CanonicalWork.id` (stable within this one computation) to
 * its cosine similarity against the query embedding. Works below
 * `MIN_SEMANTIC_SIMILARITY` are dropped — the semantic-mode equivalent of
 * `rankWorks`'s zero-token-overlap filter, but as a threshold rather than a
 * hard zero, since embedding similarity has no natural "unrelated" cutoff.
 */
export function rankWorksBySimilarity(
  works: CanonicalWork[],
  similarityByWorkId: Map<string, number>,
  now: Date = new Date(),
): CanonicalWork[] {
  return works
    .map((work) => ({ work, similarity: similarityByWorkId.get(work.id) ?? 0 }))
    .filter(({ similarity }) => similarity >= MIN_SEMANTIC_SIMILARITY)
    .map(({ work, similarity }) => ({
      ...work,
      score: scoreWorkBySimilarity(work, similarity, now),
    }))
    .sort((a, b) => b.score - a.score);
}
