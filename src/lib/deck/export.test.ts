import { describe, expect, it } from "vitest";
import { deckFilename, renderDeckMarkdown } from "@/lib/deck/export";
import { validateOutline } from "@/lib/deck/outline";
import type { CanonicalWork } from "@/lib/types/work";

function work(id: string, name: string, year: number): CanonicalWork {
  return {
    id,
    workKey: `doi:10.1/${id}`,
    title: `Paper ${id}`,
    authors: [{ name }],
    year,
    venue: "Nature",
    doi: `10.1/${id}`,
    abstract: null,
    citationCount: 0,
    isOpenAccess: false,
    pdfUrl: null,
    landingPageUrl: null,
    sources: [],
    bibliographic: null,
    topics: [],
    score: 1,
  };
}

const resolved = new Map<string, CanonicalWork | null>([
  ["doi:10.1/a", work("a", "Michael T. Lin", 2006)],
  ["doi:10.1/b", work("b", "Ada Lovelace", 1843)],
]);
const ALLOWED = [...resolved.keys()];

const OUTLINE = validateOutline(
  "## Background\n- Yields rose sharply [[doi:10.1/a]].\n## Method\n- Two designs were compared [[doi:10.1/b]] [[doi:10.1/a]].",
  ALLOWED,
);

describe("renderDeckMarkdown", () => {
  const md = renderDeckMarkdown("Crop yields", OUTLINE, resolved, "apa");

  it("opens with Marp front matter and the deck title", () => {
    expect(md.startsWith("---\nmarp: true\npaginate: true\n---\n")).toBe(true);
    expect(md).toContain("# Crop yields");
  });

  it("separates every slide with a rule", () => {
    // Front matter opens and closes with one, then one per slide, then the
    // references slide.
    expect(md.split("\n").filter((line) => line === "---")).toHaveLength(5);
  });

  it("replaces markers with formatted inline labels, never raw keys", () => {
    expect(md).toContain("(Lin, 2006)");
    expect(md).not.toContain("[[");
    expect(md).not.toContain("doi:10.1/a]]");
  });

  it("ends with a numbered reference slide in first-appearance order", () => {
    const references = md.slice(md.indexOf("## References"));
    expect(references).toContain("1. ");
    expect(references.indexOf("Lin")).toBeLessThan(references.indexOf("Lovelace"));
  });

  it("switching style re-renders labels rather than rewriting the deck", () => {
    const mla = renderDeckMarkdown("Crop yields", OUTLINE, resolved, "mla");
    expect(mla).toContain("(Lin)");
    expect(mla).not.toContain("(Lin, 2006)");
  });

  it("marks an unresolvable citation instead of dropping the claim", () => {
    const outline = validateOutline("## One\n- A claim [[doi:10.1/z]].", ["doi:10.1/z"]);
    const md = renderDeckMarkdown("Deck", outline, new Map([["doi:10.1/z", null]]), "apa");
    expect(md).toContain("[missing citation]");
    expect(md).toContain("A claim");
  });

  it("says so plainly when a deck cites nothing", () => {
    const empty = validateOutline("", ALLOWED);
    expect(renderDeckMarkdown("Deck", empty, resolved, "apa")).toContain("_No sources cited._");
  });
});

describe("deckFilename", () => {
  it("strips characters a filesystem would object to", () => {
    expect(deckFilename("CRISPR: off-target/effects?")).toBe("CRISPR off-targeteffects.md");
  });

  it("falls back rather than producing a dotfile", () => {
    expect(deckFilename("///")).toBe("deck.md");
  });
});
