/** A run of assistant text, or a `[p. N]` citation lifted out of it. */
export type CitationSegment = { type: "text"; value: string } | { type: "citation"; page: number };

/** Matches `[p. 7]`, `[p.7]`, `[pp. 7-9]`. A citation with a non-numeric or
 * missing page is left alone as literal text — the model occasionally emits
 * `[p. ?]`, and silently swallowing it would hide that from the reader. */
const CITATION_RE = /\[pp?\.\s*(\d{1,4})(?:\s*[-–]\s*(\d{1,4}))?\]/g;

/**
 * Splits assistant text into renderable segments so `ChatPanel` can turn page
 * citations into buttons that scroll the PDF.
 *
 * Pure and string-only by design: the interesting cases (adjacent citations,
 * malformed pages, a citation arriving split across two streaming chunks) are
 * all testable in this repo's node-only vitest, with no DOM.
 *
 * A range cites its first page — that is the page you want to be looking at.
 */
export function splitPageCitations(text: string): CitationSegment[] {
  const segments: CitationSegment[] = [];
  let lastIndex = 0;

  CITATION_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = CITATION_RE.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: "text", value: text.slice(lastIndex, match.index) });
    }
    segments.push({ type: "citation", page: Number(match[1]) });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    segments.push({ type: "text", value: text.slice(lastIndex) });
  }
  return segments;
}
