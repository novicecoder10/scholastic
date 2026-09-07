import { describe, expect, it } from "vitest";
import { renderMatrixMarkdown, type MarkdownRow } from "@/lib/extraction/markdownTable";

function row(overrides: Partial<MarkdownRow> = {}): MarkdownRow {
  return {
    document: "Smith 2024",
    cells: [
      { value: "128", pageNumber: 4, quote: "We recruited 128 participants.", status: "found" },
    ],
    ...overrides,
  };
}

describe("renderMatrixMarkdown", () => {
  it("renders a table with the page beside each value", () => {
    const md = renderMatrixMarkdown("Sleep review", ["Sample size"], [row()]);
    expect(md).toContain("| Paper | Sample size |");
    expect(md).toContain("| Smith 2024 | 128 (p. 4) |");
  });

  it("distinguishes a paper that does not report a field from one nothing was found in", () => {
    const md = renderMatrixMarkdown(
      "Review",
      ["Effect size"],
      [
        row({ cells: [{ value: null, pageNumber: null, quote: null, status: "not_reported" }] }),
        row({
          document: "Jones 2023",
          cells: [{ value: null, pageNumber: null, quote: null, status: "error" }],
        }),
      ],
    );
    expect(md).toContain("| Smith 2024 | *not reported* |");
    expect(md).toContain("| Jones 2023 | — |");
  });

  it("carries the quotes below the table rather than dropping them", () => {
    const md = renderMatrixMarkdown("Review", ["Sample size"], [row()]);
    expect(md).toContain("## Evidence");
    expect(md).toContain("**Smith 2024 — Sample size** (p. 4): “We recruited 128 participants.”");
  });

  it("omits the evidence section when there is nothing to evidence", () => {
    const md = renderMatrixMarkdown(
      "Review",
      ["Sample size"],
      [row({ cells: [{ value: null, pageNumber: null, quote: null, status: "not_reported" }] })],
    );
    expect(md).not.toContain("## Evidence");
  });

  it("escapes a pipe so one title cannot break the whole table", () => {
    const md = renderMatrixMarkdown(
      "Review",
      ["Model"],
      [
        row({
          document: "A | B",
          cells: [{ value: "GPT | 4", pageNumber: null, quote: null, status: "found" }],
        }),
      ],
    );
    expect(md).toContain("| A \\| B | GPT \\| 4 |");
  });

  it("flattens a quote that spans lines, which would otherwise end the row", () => {
    const md = renderMatrixMarkdown(
      "Review",
      ["Method"],
      [row({ cells: [{ value: "double-\nblind", pageNumber: 2, quote: null, status: "found" }] })],
    );
    expect(md).toContain("| Smith 2024 | double- blind (p. 2) |");
  });
});
