/** One page's extracted text, as produced by `lib/pdf/extract.ts`. */
export interface PageText {
  pageNumber: number;
  text: string;
}

export interface Chunk {
  chunkIndex: number;
  pageStart: number;
  pageEnd: number;
  content: string;
}

/** Roughly 4 characters per token; ~350 tokens of content per chunk. */
export const TARGET_CHUNK_CHARS = 1400;
/** Overlap keeps a sentence that straddles a boundary retrievable from either side. */
export const CHUNK_OVERLAP_CHARS = 200;

/**
 * Collapses the whitespace noise PDF text extraction produces: hard-wrapped
 * lines, hyphenated word breaks at line ends, and runs of spaces from column
 * layout. Deliberately conservative — it never reorders or drops text, because
 * a chunk is quoted back to the user with a page citation and must stay
 * faithful to the page.
 */
export function normalizePageText(raw: string): string {
  return (
    raw
      .replace(/\r\n?/g, "\n")
      // "experi-\nment" -> "experiment"
      .replace(/(\w)-\n(\w)/g, "$1$2")
      // A single newline inside a paragraph is a hard wrap, not a break.
      .replace(/([^\n])\n(?!\n)/g, "$1 ")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

/**
 * Page-aware chunking. Pages are concatenated in order and split at
 * ~TARGET_CHUNK_CHARS, preferring a paragraph break, then a sentence break,
 * then a space, so a chunk rarely ends mid-word. Every chunk records the page
 * range it spans, which is what makes "[page 7]" citations possible downstream.
 *
 * Pure: no I/O, no clock, no randomness.
 */
export function chunkPages(pages: PageText[]): Chunk[] {
  // A flat string plus a page index lets a chunk span a page boundary without
  // special-casing it — chunking on page boundaries alone would produce chunks
  // ranging from a title page to a dense 4000-character page.
  let flat = "";
  const pageAt: number[] = [];
  for (const page of pages) {
    const text = normalizePageText(page.text);
    if (!text) continue;
    const withSeparator = flat.length > 0 ? `\n\n${text}` : text;
    flat += withSeparator;
    for (let i = 0; i < withSeparator.length; i++) pageAt.push(page.pageNumber);
  }
  if (flat.length === 0) return [];

  const chunks: Chunk[] = [];
  let start = 0;
  while (start < flat.length) {
    const hardEnd = Math.min(start + TARGET_CHUNK_CHARS, flat.length);
    const end = hardEnd === flat.length ? hardEnd : findBreak(flat, start, hardEnd);
    const content = flat.slice(start, end).trim();
    if (content) {
      chunks.push({
        chunkIndex: chunks.length,
        pageStart: pageAt[start],
        pageEnd: pageAt[Math.min(end, pageAt.length) - 1],
        content,
      });
    }
    if (end >= flat.length) break;
    // Overlap, but never so much that the window fails to advance.
    start = Math.max(start + 1, end - CHUNK_OVERLAP_CHARS);
  }
  return chunks;
}

/** Prefers a paragraph break, then a sentence end, then a space, within the last 30%. */
function findBreak(text: string, start: number, hardEnd: number): number {
  const floor = start + Math.floor((hardEnd - start) * 0.7);
  const window = text.slice(floor, hardEnd);

  const paragraph = window.lastIndexOf("\n\n");
  if (paragraph !== -1) return floor + paragraph + 2;

  const sentence = Math.max(
    window.lastIndexOf(". "),
    window.lastIndexOf("? "),
    window.lastIndexOf("! "),
  );
  if (sentence !== -1) return floor + sentence + 2;

  const space = window.lastIndexOf(" ");
  if (space !== -1) return floor + space + 1;

  return hardEnd;
}
