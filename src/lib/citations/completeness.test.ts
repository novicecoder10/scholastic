import { describe, it, expect } from "vitest";
import { toCsl } from "@/lib/citations/csl";
import { findMissingFields, formatAllStyles, formatCitation } from "@/lib/citations";
import { bibliographic, work } from "@/lib/citations/fixtures";

describe("completeness", () => {
  it("reports nothing missing for a fully populated article", () => {
    const result = formatCitation(work(), "apa");
    expect(result.missing).toEqual([]);
    expect(result.note).toBeNull();
  });

  it("names a single missing field in the note", () => {
    const result = formatCitation(work({ bibliographic: bibliographic({ volume: null }) }), "apa");
    expect(result.missing).toEqual(["volume"]);
    expect(result.note).toBe(
      "Incomplete: no volume found for this record. Check the source before submitting.",
    );
  });

  it("lists several missing fields readably", () => {
    const result = formatCitation(
      work({ bibliographic: bibliographic({ volume: null, firstPage: null, lastPage: null }) }),
      "apa",
    );
    expect(result.note).toContain("no volume and page range found");
  });

  it("still returns the citation it can produce alongside the note", () => {
    // A partial citation the user can finish beats an invented volume or a
    // blank panel; the note is what stops it reading as finished.
    const result = formatCitation(work({ bibliographic: null }), "apa");
    expect(result.text).toContain("Smith, J. (2019).");
    expect(result.note).not.toBeNull();
  });

  it("does not flag volume, issue or pages on a preprint", () => {
    const item = toCsl(
      work({
        venue: null,
        bibliographic: bibliographic({
          type: "preprint",
          containerTitle: null,
          volume: null,
          issue: null,
          firstPage: null,
          lastPage: null,
        }),
      }),
    );
    expect(findMissingFields(item, "apa")).toEqual(["container-title"]);
  });

  it("flags a missing author list and a missing year", () => {
    const item = toCsl(
      work({ authors: [], year: null, bibliographic: bibliographic({ issued: null }) }),
    );
    expect(findMissingFields(item, "apa")).toContain("author");
    expect(findMissingFields(item, "apa")).toContain("issued");
  });

  it("never marks the export formats incomplete", () => {
    // BibTeX and RIS are lossless containers: a sparse entry is a faithful
    // record of sparse data, not a citation missing something.
    const results = formatAllStyles(work({ bibliographic: null, authors: [], year: null }));
    expect(results.bibtex.note).toBeNull();
    expect(results.ris.note).toBeNull();
    expect(results.apa.note).not.toBeNull();
  });

  it("MLA does not require a volume, and APA and Chicago do", () => {
    const item = toCsl(work({ bibliographic: bibliographic({ volume: null }) }));
    expect(findMissingFields(item, "mla")).toEqual([]);
    expect(findMissingFields(item, "apa")).toEqual(["volume"]);
    expect(findMissingFields(item, "chicago")).toEqual(["volume"]);
  });

  it("produces all five styles for one work", () => {
    const results = formatAllStyles(work());
    expect(Object.keys(results).sort()).toEqual(["apa", "bibtex", "chicago", "mla", "ris"]);
    for (const result of Object.values(results)) expect(result.text.length).toBeGreaterThan(10);
  });
});
