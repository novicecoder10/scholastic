import type { RetrievedChunk } from "@/lib/documents/retrieve";

/**
 * Formats retrieved chunks as page-attributed context blocks for the document
 * chat system prompt. Pure string-in/structure-out, separate from the route
 * for the same reason `buildSynthesisContext` is: it is the part worth testing,
 * and it has no business knowing about HTTP.
 *
 * The `[page N]` header is what makes `[p. N]` citations answerable — the model
 * can only cite a page it was told the excerpt came from.
 */
export function buildDocumentContext(chunks: RetrievedChunk[]): string {
  return chunks.map((chunk) => `[${pageLabel(chunk)}]\n${chunk.content.trim()}`).join("\n\n");
}

/** A chunk can span a page boundary (see chunkPages in lib/pdf/chunk.ts), so a
 * single page number would be a lie for roughly one chunk in ten. */
function pageLabel(chunk: RetrievedChunk): string {
  return chunk.pageStart === chunk.pageEnd
    ? `page ${chunk.pageStart}`
    : `pages ${chunk.pageStart}-${chunk.pageEnd}`;
}
