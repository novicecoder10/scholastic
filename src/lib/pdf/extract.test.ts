import { describe, expect, it } from "vitest";
import { looksLikePdf, MAX_PAGES } from "@/lib/pdf/extract";

describe("looksLikePdf", () => {
  it("accepts bytes beginning with the PDF signature", () => {
    expect(looksLikePdf(Buffer.from("%PDF-1.7\n%\xE2\xE3\xCF\xD3", "latin1"))).toBe(true);
  });

  it("rejects a file whose declared type lies about its contents", () => {
    // A ZIP, which is what a .docx renamed to .pdf actually is.
    expect(looksLikePdf(Buffer.from("PK\x03\x04rest of a zip", "latin1"))).toBe(false);
  });

  it("rejects HTML", () => {
    expect(looksLikePdf(Buffer.from("<!doctype html><html>", "latin1"))).toBe(false);
  });

  it("rejects a file too short to carry the signature", () => {
    expect(looksLikePdf(Buffer.from("%PD", "latin1"))).toBe(false);
  });

  it("rejects an empty file", () => {
    expect(looksLikePdf(new Uint8Array())).toBe(false);
  });

  it("caps pages at a documented limit", () => {
    expect(MAX_PAGES).toBe(500);
  });
});
