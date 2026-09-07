import { describe, it, expect } from "vitest";
import {
  keepQuotedFindings,
  quoteAppearsIn,
  validateInterpretation,
} from "@/lib/extraction/guards";

const GRID = [
  ["Group", "N", "Mean (mg/dL)"],
  ["Control", "42", "3.1"],
  ["Treatment", "41", "4.7"],
];

describe("validateInterpretation", () => {
  it("accepts a header row and units that appear in the grid", () => {
    const result = validateInterpretation(GRID, {
      headerRow: 0,
      units: [null, null, "mg/dL"],
      description: "Mean concentration by group.",
    });
    expect(result).toEqual({
      headerRow: 0,
      units: [null, null, "mg/dL"],
      description: "Mean concentration by group.",
    });
  });

  it("discards the whole interpretation when a unit is not in the grid", () => {
    // The invention this guard exists for: a plausible unit the table never
    // stated. The raw grid then stands unlabelled, which is honest.
    expect(
      validateInterpretation(GRID, {
        headerRow: 0,
        units: [null, "participants", "mg/dL"],
        description: "Mean concentration by group.",
      }),
    ).toBeNull();
  });

  it("rejects a header row outside the grid", () => {
    expect(
      validateInterpretation(GRID, { headerRow: 9, units: [null, null, null], description: "x" }),
    ).toBeNull();
  });

  it("rejects a units array of the wrong length", () => {
    // A short array would silently apply each unit to the wrong column.
    expect(
      validateInterpretation(GRID, { headerRow: 0, units: [null, null], description: "x" }),
    ).toBeNull();
  });

  it("accepts a table with no header row", () => {
    expect(
      validateInterpretation(GRID, {
        headerRow: null,
        units: [null, null, null],
        description: "Values by group.",
      }),
    ).not.toBeNull();
  });

  it("rejects an empty description rather than storing a blank label", () => {
    expect(
      validateInterpretation(GRID, { headerRow: 0, units: [null, null, null], description: "  " }),
    ).toBeNull();
  });

  it("rejects anything that is not an object", () => {
    expect(validateInterpretation(GRID, "sure thing")).toBeNull();
    expect(validateInterpretation(GRID, null)).toBeNull();
  });

  it("matches a unit case- and whitespace-insensitively", () => {
    expect(
      validateInterpretation(GRID, {
        headerRow: 0,
        units: [null, null, "MG/DL"],
        description: "x",
      }),
    ).not.toBeNull();
  });
});

describe("quoteAppearsIn", () => {
  const SOURCE = "We recruited 412 participants\nacross  three sites in 2024.";

  it("ignores the whitespace differences a PDF text layer always introduces", () => {
    expect(quoteAppearsIn(SOURCE, "412 participants across three sites")).toBe(true);
  });

  it("rejects a quote that is not in the source", () => {
    expect(quoteAppearsIn(SOURCE, "We recruited 512 participants")).toBe(false);
  });

  it("rejects an empty quote", () => {
    expect(quoteAppearsIn(SOURCE, "   ")).toBe(false);
  });
});

describe("keepQuotedFindings", () => {
  const CHUNK = "In total we recruited 412 participants across three sites. Attrition was 8%.";

  it("keeps a finding whose quote and value both check out", () => {
    expect(
      keepQuotedFindings(CHUNK, [{ value: "412", quote: "we recruited 412 participants" }]),
    ).toHaveLength(1);
  });

  it("drops a finding whose quote is not in the chunk", () => {
    expect(
      keepQuotedFindings(CHUNK, [{ value: "412", quote: "a total of 412 were enrolled" }]),
    ).toEqual([]);
  });

  it("drops a genuine quote that does not contain the value it is cited for", () => {
    // The check people forget. This reads as provenanced and is not: the quote
    // is real, the number was inferred from it.
    expect(
      keepQuotedFindings(CHUNK, [{ value: "412", quote: "across three sites" }]),
    ).toEqual([]);
  });

  it("keeps the good findings and drops the bad ones in one pass", () => {
    const kept = keepQuotedFindings(CHUNK, [
      { value: "412", quote: "we recruited 412 participants" },
      { value: "0.001", quote: "p < 0.001 for the primary endpoint" },
      { value: "8%", quote: "Attrition was 8%" },
    ]);
    expect(kept.map((f) => f.value)).toEqual(["412", "8%"]);
  });
});
