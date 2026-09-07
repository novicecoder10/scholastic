import { describe, it, expect } from "vitest";
import { exportManuscript } from "@/lib/manuscript/export";
import type { CanonicalWork } from "@/lib/types/work";
import type { DocNode } from "@/lib/manuscript/types";

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

const A = work("a", "Michael T. Lin", 2006);
const B = work("b", "Ada Lovelace", 1843);
const resolved = new Map<string, CanonicalWork | null>([
  ["doi:10.1/a", A],
  ["doi:10.1/b", B],
]);

const DOC: DocNode = {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Introduction" }] },
    {
      type: "paragraph",
      content: [
        { type: "text", text: "Mitochondria matter " },
        { type: "citation", attrs: { workKey: "doi:10.1/a" } },
        { type: "text", text: " and so does computing " },
        { type: "citation", attrs: { workKey: "doi:10.1/b" } },
        { type: "text", text: "." },
      ],
    },
  ],
};

describe("markdown export", () => {
  it("emits the body and a references section in citation order", () => {
    const result = exportManuscript(DOC, "My review", resolved, "apa", "markdown");
    expect(result.filename).toBe("My review.md");
    expect(result.content).toContain("# My review");
    expect(result.content).toContain("## References");
    expect(result.content.indexOf("Lin")).toBeLessThan(result.content.indexOf("Lovelace"));
  });

  it("uses the active style's inline labels", () => {
    const apa = exportManuscript(DOC, "t", resolved, "apa", "markdown").content;
    expect(apa).toContain("(Lin, 2006)");
  });

  it("keeps an unresolvable citation visible in both places", () => {
    const broken: DocNode = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "citation", attrs: { workKey: "gone" } }] }],
    };
    const content = exportManuscript(broken, "t", new Map([["gone", null]]), "apa", "markdown")
      .content;
    // Inline and in the bibliography. Dropping it would leave the claim
    // standing with no attribution.
    expect(content.match(/\[missing citation\]/g)?.length).toBe(2);
  });
});

describe("latex export", () => {
  it("cites with keys that match the companion .bib exactly", () => {
    // The one way a LaTeX export usually breaks: two different key generators.
    const result = exportManuscript(DOC, "My review", resolved, "apa", "latex");
    const cited = [...result.content.matchAll(/\\cite\{([^}]+)\}/g)].map((m) => m[1]);
    const declared = [...(result.bib ?? "").matchAll(/@\w+\{([^,]+),/g)].map((m) => m[1]);
    expect(cited).toHaveLength(2);
    expect(cited.sort()).toEqual(declared.sort());
  });

  it("escapes LaTeX's reserved characters in body text", () => {
    const doc: DocNode = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "50% of cases & more_" }] }],
    };
    const content = exportManuscript(doc, "t", resolved, "apa", "latex").content;
    expect(content).toContain("50\\% of cases \\& more\\_");
  });

  it("names the .bib file the document expects to find", () => {
    const result = exportManuscript(DOC, "My review", resolved, "apa", "latex");
    expect(result.content).toContain("\\bibliography{My review}");
    expect(result.filename).toBe("My review.tex");
  });
});

describe("bibliography-only exports", () => {
  it("emits BibTeX entries for the cited works and no body", () => {
    const result = exportManuscript(DOC, "t", resolved, "apa", "bibtex");
    expect(result.content).toContain("@article{");
    expect(result.content).not.toContain("Mitochondria matter");
    expect(result.filename).toBe("t.bib");
  });

  it("emits RIS with the right extension and content type", () => {
    const result = exportManuscript(DOC, "t", resolved, "apa", "ris");
    expect(result.content).toContain("TY  - ");
    expect(result.filename).toBe("t.ris");
  });

  it("skips unresolvable works rather than emitting a malformed entry", () => {
    const doc: DocNode = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "citation", attrs: { workKey: "gone" } }] }],
    };
    expect(exportManuscript(doc, "t", new Map([["gone", null]]), "apa", "bibtex").content).toBe("");
  });
});

describe("filenames", () => {
  it("strips characters that would forge a Content-Disposition header", () => {
    const result = exportManuscript(DOC, 'evil"; drop\n', resolved, "apa", "markdown");
    expect(result.filename).toBe("evil drop.md");
  });

  it("falls back to a default when a title strips to nothing", () => {
    expect(exportManuscript(DOC, "…", resolved, "apa", "markdown").filename).toBe("manuscript.md");
  });
});
