import type { CanonicalWork } from "@/lib/types/work";

/**
 * The subset of CSL-JSON this app produces.
 *
 * CSL-JSON is the intermediate representation on purpose: it is what every
 * reference manager already speaks, it makes BibTeX and RIS export close to
 * free, and #8's auto-citation consumes it directly instead of reimplementing
 * this mapping against `CanonicalWork`.
 */
export interface CslName {
  family: string;
  given?: string;
  /** Set instead of family/given for corporate authors ("World Health
   * Organization"), which must never be initialised or inverted. */
  literal?: string;
}

export interface CslItem {
  id: string;
  type: string;
  title: string;
  author: CslName[];
  issued: { "date-parts": [number[]] } | null;
  "container-title": string | null;
  volume: string | null;
  issue: string | null;
  page: string | null;
  publisher: string | null;
  DOI: string | null;
  URL: string | null;
  ISSN: string | null;
  ISBN: string | null;
}

/** Crossref/OpenAlex type vocabularies → CSL types. Anything unrecognised
 * falls back to "document", which every style renders conservatively rather
 * than asserting a journal article's structure it can't support. */
const TYPE_MAP: Record<string, string> = {
  "journal-article": "article-journal",
  "proceedings-article": "paper-conference",
  "book-chapter": "chapter",
  "posted-content": "article",
  preprint: "article",
  article: "article-journal",
  book: "book",
  dataset: "dataset",
  dissertation: "thesis",
  report: "report",
  "Journal Article": "article-journal",
  Review: "article-journal",
};

/**
 * Splits a display name into CSL family/given.
 *
 * Every provider hands us one flat string, so this has to guess, and it guesses
 * conservatively: a name with no space, or one carrying a corporate marker, is
 * emitted as a `literal` rather than being forced into a surname. Rendering
 * "Organization, W." is a visible error in a bibliography; rendering the full
 * name unabbreviated is not.
 */
export function toCslName(name: string): CslName {
  const trimmed = name.trim();
  if (trimmed === "") return { family: "Unknown", literal: "Unknown" };

  // "Smith, John" — the one unambiguous form, and PubMed-style "Smith J".
  const comma = trimmed.indexOf(",");
  if (comma > 0) {
    return { family: trimmed.slice(0, comma).trim(), given: trimmed.slice(comma + 1).trim() };
  }

  const parts = trimmed.split(/\s+/);
  if (parts.length === 1 || looksCorporate(trimmed)) return { family: trimmed, literal: trimmed };

  return { family: parts[parts.length - 1], given: parts.slice(0, -1).join(" ") };
}

const CORPORATE_MARKERS =
  /\b(university|institute|organization|organisation|association|society|department|ministry|centre|center|consortium|group|committee|agency|laborator(y|ies)|council|foundation|company|inc|ltd|llc|gmbh)\b/i;

function looksCorporate(name: string): boolean {
  return CORPORATE_MARKERS.test(name);
}

function pageRange(work: CanonicalWork): string | null {
  const bib = work.bibliographic;
  if (!bib?.firstPage) return null;
  return bib.lastPage ? `${bib.firstPage}-${bib.lastPage}` : bib.firstPage;
}

export function toCsl(work: CanonicalWork): CslItem {
  const bib = work.bibliographic;

  // `bibliographic.issued` is more precise than `year` when present (it can
  // carry month and day), but `year` is reconciled across the whole cluster,
  // so it is the safer fallback when no source supplied a full date.
  const issuedParts = bib?.issued
    ? [bib.issued.year, bib.issued.month, bib.issued.day].filter(
        (n): n is number => typeof n === "number",
      )
    : work.year !== null
      ? [work.year]
      : null;

  return {
    id: work.workKey,
    type: (bib?.type && TYPE_MAP[bib.type]) ?? (bib?.type ? "document" : "article-journal"),
    title: work.title,
    author: work.authors.map((a) => toCslName(a.name)),
    issued: issuedParts ? { "date-parts": [issuedParts] } : null,
    "container-title": bib?.containerTitle ?? work.venue,
    volume: bib?.volume ?? null,
    issue: bib?.issue ?? null,
    page: pageRange(work),
    publisher: bib?.publisher ?? null,
    DOI: work.doi,
    URL: work.landingPageUrl,
    ISSN: bib?.issn ?? null,
    ISBN: bib?.isbn ?? null,
  };
}

/** The publication year, or null. Styles render null as their own "no date"
 * marker (APA's `n.d.`), which is a real bibliographic statement — not a bug. */
export function cslYear(item: CslItem): number | null {
  return item.issued?.["date-parts"][0][0] ?? null;
}
