import { describe, it, expect } from "vitest";
import {
  BROKEN_CITATION_LABEL,
  buildBibliography,
  collectCitedWorkKeys,
  inlineLabel,
} from "@/lib/manuscript/bibliography";
import type { CanonicalWork } from "@/lib/types/work";
import type { DocNode } from "@/lib/manuscript/types";

function work(overrides: Partial<CanonicalWork> = {}): CanonicalWork {
  return {
    id: "1",
    workKey: "doi:10.1/a",
    title: "A paper",
    authors: [{ name: "Michael T. Lin" }],
    year: 2006,
    venue: "Nature",
    doi: "10.1/a",
    abstract: null,
    citationCount: 0,
    isOpenAccess: false,
    pdfUrl: null,
    landingPageUrl: null,
    sources: [],
    bibliographic: null,
    topics: [],
    score: 1,
    ...overrides,
  };
}

function paragraph(...content: DocNode[]): DocNode {
  return { type: "paragraph", content };
}
function cite(workKey: string): DocNode {
  return { type: "citation", attrs: { workKey } };
}
function text(value: string): DocNode {
  return { type: "text", text: value };
}

describe("collectCitedWorkKeys", () => {
  it("collects in first-appearance order", () => {
    const doc: DocNode = {
      type: "doc",
      content: [paragraph(text("a"), cite("k2")), paragraph(text("b"), cite("k1"))],
    };
    expect(collectCitedWorkKeys(doc)).toEqual(["k2", "k1"]);
  });

  it("collapses a work cited twice to one entry", () => {
    const doc: DocNode = {
      type: "doc",
      content: [paragraph(cite("k1")), paragraph(cite("k1"))],
    };
    expect(collectCitedWorkKeys(doc)).toEqual(["k1"]);
  });

  it("changes order when the paragraphs are reordered", () => {
    // The reason a citation node stores only a workKey: order is derived, so
    // moving a paragraph renumbers without touching a single node.
    const first = paragraph(cite("k1"));
    const second = paragraph(cite("k2"));
    expect(collectCitedWorkKeys({ type: "doc", content: [first, second] })).toEqual(["k1", "k2"]);
    expect(collectCitedWorkKeys({ type: "doc", content: [second, first] })).toEqual(["k2", "k1"]);
  });

  it("drops a work when its last citation is deleted", () => {
    expect(
      collectCitedWorkKeys({ type: "doc", content: [paragraph(text("no citation"))] }),
    ).toEqual([]);
  });

  it("finds citations nested inside lists and quotes", () => {
    const doc: DocNode = {
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: [{ type: "listItem", content: [paragraph(cite("k9"))] }],
        },
      ],
    };
    expect(collectCitedWorkKeys(doc)).toEqual(["k9"]);
  });

  it("ignores a citation node with no workKey rather than emitting an empty entry", () => {
    expect(
      collectCitedWorkKeys({ type: "doc", content: [paragraph({ type: "citation" })] }),
    ).toEqual([]);
  });

  it("handles an empty or absent document", () => {
    expect(collectCitedWorkKeys(null)).toEqual([]);
    expect(collectCitedWorkKeys({ type: "doc" })).toEqual([]);
  });
});

describe("inlineLabel", () => {
  const resolved = { workKey: "k1", work: work() };

  it("uses author and year for an author-date style", () => {
    expect(inlineLabel(resolved, 0, "apa")).toBe("(Lin, 2006)");
  });

  it("adds et al. past two authors", () => {
    const many = {
      workKey: "k1",
      work: work({ authors: [{ name: "A One" }, { name: "B Two" }, { name: "C Three" }] }),
    };
    expect(inlineLabel(many, 0, "apa")).toBe("(One et al., 2006)");
  });

  it("omits the year for MLA, which cites author and page", () => {
    // A bibliography has no page to give, so a year MLA would never print is
    // worse than author alone.
    expect(inlineLabel(resolved, 0, "mla")).toBe("(Lin)");
  });

  it("falls back to a position number when there is no author to name", () => {
    expect(inlineLabel({ workKey: "k", work: work({ authors: [] }) }, 2, "apa")).toBe("[3]");
  });

  it("says n.d. rather than inventing a year", () => {
    expect(inlineLabel({ workKey: "k", work: work({ year: null }) }, 0, "apa")).toBe("(Lin, n.d.)");
  });

  it("renders an unresolvable key as a visible marker, never as nothing", () => {
    // A citation that quietly disappears leaves the claim and loses the
    // attribution, which is a plagiarism risk rather than a rendering bug.
    expect(inlineLabel(undefined, 0, "apa")).toBe(BROKEN_CITATION_LABEL);
    expect(inlineLabel({ workKey: "k", work: null }, 0, "apa")).toBe(BROKEN_CITATION_LABEL);
  });
});

describe("buildBibliography", () => {
  it("formats each entry through the shared citation formatters", () => {
    const entries = buildBibliography("k1".split(" "), new Map([["k1", work()]]), "apa");
    expect(entries[0].missing).toBe(false);
    expect(entries[0].text).toContain("Lin");
  });

  it("keeps an unresolvable entry, flagged", () => {
    const entries = buildBibliography(["gone"], new Map([["gone", null]]), "apa");
    expect(entries).toEqual([{ workKey: "gone", text: null, missing: true }]);
  });

  it("changes only the text when the style changes", () => {
    const resolved = new Map([["k1", work()]]);
    const apa = buildBibliography(["k1"], resolved, "apa");
    const mla = buildBibliography(["k1"], resolved, "mla");
    expect(apa[0].workKey).toBe(mla[0].workKey);
    expect(apa[0].text).not.toBe(mla[0].text);
  });
});

describe("manuscript styles", () => {
  it("offers only prose styles", async () => {
    const { MANUSCRIPT_STYLES, isManuscriptStyle } = await import("@/lib/manuscript/bibliography");
    expect(MANUSCRIPT_STYLES).toEqual(["apa", "mla", "chicago"]);
    // BibTeX and RIS are interchange formats. Offering them as a manuscript
    // style produced a markdown export whose references section was a list of
    // @article{...} entries.
    expect(isManuscriptStyle("bibtex")).toBe(false);
    expect(isManuscriptStyle("apa")).toBe(true);
  });
});
