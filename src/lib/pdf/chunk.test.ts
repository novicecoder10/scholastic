import { describe, expect, it } from "vitest";
import {
  CHUNK_OVERLAP_CHARS,
  TARGET_CHUNK_CHARS,
  chunkPages,
  normalizePageText,
  type PageText,
} from "@/lib/pdf/chunk";

describe("normalizePageText", () => {
  it("rejoins a word hyphenated across a line break", () => {
    expect(normalizePageText("we ran an experi-\nment today")).toBe("we ran an experiment today");
  });

  it("treats a single newline as a hard wrap, not a paragraph break", () => {
    expect(normalizePageText("the quick brown\nfox jumps")).toBe("the quick brown fox jumps");
  });

  it("preserves a blank line as a paragraph break", () => {
    expect(normalizePageText("first para\n\nsecond para")).toBe("first para\n\nsecond para");
  });

  it("collapses runs of spaces left by column layout", () => {
    expect(normalizePageText("a     b\tc")).toBe("a b c");
  });

  it("normalizes CRLF", () => {
    expect(normalizePageText("a\r\n\r\nb")).toBe("a\n\nb");
  });
});

function longPage(pageNumber: number, sentences: number): PageText {
  const text = Array.from(
    { length: sentences },
    (_, i) => `Sentence ${i} on page ${pageNumber} about retrieval augmented generation.`,
  ).join(" ");
  return { pageNumber, text };
}

describe("chunkPages", () => {
  it("returns nothing for pages with no text", () => {
    expect(chunkPages([{ pageNumber: 1, text: "   " }])).toEqual([]);
  });

  it("keeps a short document as a single chunk on its own page", () => {
    const chunks = chunkPages([{ pageNumber: 1, text: "A short abstract." }]);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({ chunkIndex: 0, pageStart: 1, pageEnd: 1 });
    expect(chunks[0].content).toBe("A short abstract.");
  });

  it("numbers chunks consecutively from zero", () => {
    const chunks = chunkPages([longPage(1, 200)]);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.map((c) => c.chunkIndex)).toEqual(chunks.map((_, i) => i));
  });

  it("keeps chunks near the target size", () => {
    const chunks = chunkPages([longPage(1, 200)]);
    for (const chunk of chunks.slice(0, -1)) {
      expect(chunk.content.length).toBeLessThanOrEqual(TARGET_CHUNK_CHARS);
    }
  });

  it("records a page range spanning a page boundary", () => {
    const chunks = chunkPages([longPage(1, 40), longPage(2, 40), longPage(3, 40)]);
    expect(chunks.some((c) => c.pageEnd > c.pageStart)).toBe(true);
    for (const chunk of chunks) {
      expect(chunk.pageStart).toBeLessThanOrEqual(chunk.pageEnd);
      expect(chunk.pageStart).toBeGreaterThanOrEqual(1);
      expect(chunk.pageEnd).toBeLessThanOrEqual(3);
    }
  });

  it("overlaps successive chunks so a straddling sentence stays retrievable", () => {
    const chunks = chunkPages([longPage(1, 200)]);
    const first = chunks[0].content;
    const second = chunks[1].content;
    const tail = first.slice(-Math.min(CHUNK_OVERLAP_CHARS / 2, first.length));
    expect(second.includes(tail.trim().split(" ").slice(-3).join(" "))).toBe(true);
  });

  it("always advances, even when no break candidate exists", () => {
    const chunks = chunkPages([{ pageNumber: 1, text: "x".repeat(TARGET_CHUNK_CHARS * 3) }]);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.length).toBeLessThan(50);
  });

  it("skips blank pages without breaking page attribution", () => {
    const chunks = chunkPages([
      { pageNumber: 1, text: "Intro text." },
      { pageNumber: 2, text: "" },
      { pageNumber: 3, text: "Conclusion text." },
    ]);
    const pages = new Set(chunks.flatMap((c) => [c.pageStart, c.pageEnd]));
    expect(pages.has(2)).toBe(false);
    expect(pages.has(1)).toBe(true);
    expect(pages.has(3)).toBe(true);
  });
});
