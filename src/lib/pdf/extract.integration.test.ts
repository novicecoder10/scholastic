import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { chunkPages } from "@/lib/pdf/chunk";
import { extractPdf, NotAPdfError } from "@/lib/pdf/extract";

/**
 * Exercises the real unpdf/pdfjs path against a committed PDF, because the
 * unit tests above mock extraction and would happily pass against a library
 * that had stopped working.
 */
const bytes = new Uint8Array(
  readFileSync(path.join(__dirname, "../../test/fixtures/sample-paper.pdf")),
);

describe("extractPdf against a real PDF", () => {
  it("extracts a text layer from every page", async () => {
    const result = await extractPdf(bytes);
    expect(result.pageCount).toBeGreaterThan(1);
    expect(result.truncated).toBe(false);
    expect(result.pages).toHaveLength(result.pageCount);
    expect(result.pages[0].text).toContain("mitochondrial dysfunction");
    expect(result.pages[0].pageNumber).toBe(1);
  });

  it("produces page-attributed chunks spanning the document", async () => {
    const { pages, pageCount } = await extractPdf(bytes);
    const chunks = chunkPages(pages);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.map((c) => c.chunkIndex)).toEqual(chunks.map((_, i) => i));
    expect(Math.min(...chunks.map((c) => c.pageStart))).toBe(1);
    expect(Math.max(...chunks.map((c) => c.pageEnd))).toBeLessThanOrEqual(pageCount);

    for (const chunk of chunks) {
      expect(chunk.content.length).toBeGreaterThan(0);
      expect(chunk.pageStart).toBeLessThanOrEqual(chunk.pageEnd);
    }
  });

  it("does not consume the caller's buffer", async () => {
    // pdfjs detaches any ArrayBuffer handed to it. A regression here writes
    // byteSize: 0 for every upload, which is why this is asserted explicitly.
    const own = new Uint8Array(bytes);
    const lengthBefore = own.byteLength;
    await extractPdf(own);
    expect(own.byteLength).toBe(lengthBefore);
  });

  it("rejects a non-PDF that reaches it", async () => {
    await expect(extractPdf(Buffer.from("PK\x03\x04zip", "latin1"))).rejects.toBeInstanceOf(
      NotAPdfError,
    );
  });
});
