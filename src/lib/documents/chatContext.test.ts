import { describe, it, expect } from "vitest";
import { buildDocumentContext } from "@/lib/documents/chatContext";
import type { RetrievedChunk } from "@/lib/documents/retrieve";

function chunk(partial: Partial<RetrievedChunk>): RetrievedChunk {
  return {
    chunkIndex: 0,
    pageStart: 1,
    pageEnd: 1,
    content: "text",
    score: 1,
    lexical: false,
    ...partial,
  };
}

describe("buildDocumentContext", () => {
  it("returns an empty string when retrieval found nothing", () => {
    expect(buildDocumentContext([])).toBe("");
  });

  it("prefixes each chunk with the page it came from", () => {
    expect(buildDocumentContext([chunk({ pageStart: 7, pageEnd: 7, content: "Methods." })])).toBe(
      "[page 7]\nMethods.",
    );
  });

  it("labels a chunk spanning a page boundary as a range", () => {
    expect(buildDocumentContext([chunk({ pageStart: 4, pageEnd: 5, content: "Spans." })])).toBe(
      "[pages 4-5]\nSpans.",
    );
  });

  it("separates blocks with a blank line and trims chunk whitespace", () => {
    expect(
      buildDocumentContext([
        chunk({ pageStart: 1, content: "  first  " }),
        chunk({ pageStart: 2, pageEnd: 2, content: "\nsecond\n" }),
      ]),
    ).toBe("[page 1]\nfirst\n\n[page 2]\nsecond");
  });

  it("preserves retrieval order (highest scoring first) rather than sorting by page", () => {
    const out = buildDocumentContext([
      chunk({ pageStart: 9, pageEnd: 9, content: "best" }),
      chunk({ pageStart: 2, pageEnd: 2, content: "next" }),
    ]);
    expect(out.indexOf("[page 9]")).toBeLessThan(out.indexOf("[page 2]"));
  });
});
