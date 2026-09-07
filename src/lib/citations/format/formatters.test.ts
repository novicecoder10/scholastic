import { describe, it, expect } from "vitest";
import { toCsl } from "@/lib/citations/csl";
import { bibliographic, work } from "@/lib/citations/fixtures";
import { formatApa } from "@/lib/citations/format/apa";
import { formatMla } from "@/lib/citations/format/mla";
import { formatChicago } from "@/lib/citations/format/chicago";
import { formatBibtex, bibtexKey, escapeBibtex } from "@/lib/citations/format/bibtex";
import { formatRis } from "@/lib/citations/format/ris";
import type { CanonicalWork } from "@/lib/types/work";

const item = (overrides: Partial<CanonicalWork> = {}) => toCsl(work(overrides));

function authorList(count: number) {
  return Array.from({ length: count }, (_, i) => ({ name: `Given${i} Family${i}` }));
}

describe("APA", () => {
  it("renders a complete journal article", () => {
    expect(formatApa(item())).toBe(
      "Smith, J. (2019). Mitochondrial Dysfunction in Model Systems. Journal of Cell Biology, 218(3), 125-134. https://doi.org/10.1000/xyz",
    );
  });

  it("joins two authors with an ampersand", () => {
    const out = formatApa(item({ authors: [{ name: "Jane Smith" }, { name: "Ann Doe" }] }));
    expect(out).toContain("Smith, J., & Doe, A.");
  });

  it("renders n.d. rather than omitting the date", () => {
    // A citation with no year must SAY it has no year; a silent gap reads as
    // a formatting slip rather than a property of the record.
    expect(
      formatApa(item({ year: null, bibliographic: bibliographic({ issued: null }) })),
    ).toContain("(n.d.).");
  });

  it("applies the 21-author ellipsis rule", () => {
    const out = formatApa(item({ authors: authorList(21) }));
    expect(out).toContain(". . . Family20");
    expect(out).not.toContain("Family19,");
    expect(out.split(". . .")[0].split("Family").length - 1).toBe(19);
  });

  it("lists all twenty authors at the boundary", () => {
    const out = formatApa(item({ authors: authorList(20) }));
    expect(out).not.toContain(". . .");
    expect(out).toContain("& Family19");
  });

  it("never inverts a corporate author", () => {
    const out = formatApa(item({ authors: [{ name: "World Health Organization" }] }));
    expect(out).toContain("World Health Organization. (2019).");
  });

  it("omits volume, issue and pages for a preprint", () => {
    const out = formatApa(
      item({
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
    expect(out).not.toContain("(3)");
    expect(out).toContain("https://doi.org/10.1000/xyz");
  });

  it("falls back to the landing page when there is no DOI", () => {
    expect(formatApa(item({ doi: null, landingPageUrl: "https://example.org/p" }))).toContain(
      "https://example.org/p",
    );
  });

  it("does not double a period after a title that ends in one", () => {
    expect(formatApa(item({ title: "Why?" }))).not.toContain("Why?.");
  });

  it("renders with no authors at all", () => {
    const out = formatApa(item({ authors: [] }));
    expect(out.startsWith("(2019).")).toBe(true);
  });
});

describe("MLA", () => {
  it("renders a complete journal article", () => {
    expect(formatMla(item())).toBe(
      'Smith, Jane. "Mitochondrial Dysfunction in Model Systems." *Journal of Cell Biology*, vol. 218, no. 3, 2019, pp. 125-134. https://doi.org/10.1000/xyz.',
    );
  });

  it("inverts only the first of two authors", () => {
    const out = formatMla(item({ authors: [{ name: "Jane Smith" }, { name: "Ann Doe" }] }));
    expect(out).toContain("Smith, Jane, and Ann Doe.");
  });

  it("uses et al. from three authors", () => {
    expect(formatMla(item({ authors: authorList(3) }))).toContain("Family0, Given0, et al.");
  });
});

describe("Chicago", () => {
  it("renders a complete journal article", () => {
    expect(formatChicago(item())).toBe(
      'Smith, Jane. 2019. "Mitochondrial Dysfunction in Model Systems." Journal of Cell Biology 218, no. 3: 125-134. https://doi.org/10.1000/xyz.',
    );
  });

  it("keeps the comma before 'and' for two authors, whose first name is inverted", () => {
    // Without it, "Lin, Michael T. and M. Flint Beal" reads as three names —
    // the comma inside the inverted first name becomes the list separator.
    expect(
      formatChicago(item({ authors: [{ name: "Michael T. Lin" }, { name: "M. Flint Beal" }] })),
    ).toContain("Lin, Michael T., and M. Flint Beal.");
  });

  it("switches to et al. past ten authors", () => {
    expect(formatChicago(item({ authors: authorList(11) }))).toContain("Family0, Given0, et al.");
    expect(formatChicago(item({ authors: authorList(10) }))).not.toContain("et al.");
  });

  it("renders a book chapter through its publisher", () => {
    const out = formatChicago(
      item({
        venue: null,
        bibliographic: bibliographic({
          type: "book-chapter",
          containerTitle: null,
          publisher: "MIT Press",
        }),
      }),
    );
    expect(out).toContain("MIT Press.");
  });
});

describe("BibTeX", () => {
  it("renders a complete entry", () => {
    const out = formatBibtex(item());
    expect(out).toContain("@article{smith2019mitochondrial,");
    expect(out).toContain("author = {Smith, Jane}");
    expect(out).toContain("pages = {125--134}");
    expect(out).toContain("doi = {10.1000/xyz}");
  });

  it("escapes characters that would corrupt the entry at typeset time", () => {
    expect(escapeBibtex("Cost & Benefit: 50% of R&D")).toBe("Cost \\& Benefit: 50\\% of R\\&D");
  });

  it("braces acronyms so BibTeX cannot lowercase them", () => {
    expect(formatBibtex(item({ title: "DNA Methylation in BRCA1 Carriers" }))).toContain(
      "{DNA} Methylation in {BRCA1} Carriers",
    );
  });

  it("produces a stable key for the same work", () => {
    expect(bibtexKey(item())).toBe(bibtexKey(item()));
  });

  it("falls back to anon/nd for a work with no author or year", () => {
    expect(
      bibtexKey(item({ authors: [], year: null, bibliographic: bibliographic({ issued: null }) })),
    ).toBe("anonndmitochondrial");
  });

  it("wraps a corporate author in braces so it is not split on 'and'", () => {
    expect(formatBibtex(item({ authors: [{ name: "World Health Organization" }] }))).toContain(
      "author = {{World Health Organization}}",
    );
  });

  it("uses booktitle for conference papers", () => {
    const out = formatBibtex(
      item({ bibliographic: bibliographic({ type: "proceedings-article" }) }),
    );
    expect(out).toContain("@inproceedings{");
    expect(out).toContain("booktitle = {Journal of Cell Biology}");
  });
});

describe("RIS", () => {
  it("renders a complete record with the exact two-space tag separator", () => {
    const out = formatRis(item());
    expect(out.split("\n")[0]).toBe("TY  - JOUR");
    expect(out).toContain("AU  - Smith, Jane");
    expect(out).toContain("SP  - 125");
    expect(out).toContain("EP  - 134");
    expect(out).toContain("DA  - 2019/03/04/");
    expect(out.endsWith("ER  - ")).toBe(true);
  });

  it("emits one AU line per author", () => {
    expect(formatRis(item({ authors: authorList(3) })).match(/^AU {2}- /gm)).toHaveLength(3);
  });

  it("flattens a newline inside a value, which would otherwise read as a new tag", () => {
    const out = formatRis(item({ title: "A Title\nSplit Across Lines" }));
    expect(out).toContain("TI  - A Title Split Across Lines");
  });

  it("omits EP when there is no last page", () => {
    const out = formatRis(item({ bibliographic: bibliographic({ lastPage: null }) }));
    expect(out).toContain("SP  - 125");
    expect(out).not.toContain("EP  - ");
  });
});
