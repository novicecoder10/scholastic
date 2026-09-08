import { describe, it, expect } from "vitest";
import {
  columnBands,
  detectTables,
  groupIntoLines,
  tableConfidence,
  type PositionedItem,
} from "@/lib/pdf/tables";

/**
 * Fixtures are recorded `PositionedItem[]`, not PDFs: the unit under test is
 * geometry, and parsing a document to reach it would make every failure
 * ambiguous between "the detector is wrong" and "pdfjs changed".
 */
const CHAR = 5;

function item(text: string, x: number, y: number): PositionedItem {
  return { text, x, y, width: text.length * CHAR, height: 10 };
}

/** Right-aligns a cell so its END sits at `right` — the numeric-column case. */
function rightItem(text: string, right: number, y: number): PositionedItem {
  return { text, x: right - text.length * CHAR, y, width: text.length * CHAR, height: 10 };
}

function row(y: number, cells: Array<[string, number]>): PositionedItem[] {
  return cells.map(([text, x]) => item(text, x, y));
}

describe("groupIntoLines", () => {
  it("orders items left to right regardless of draw order", () => {
    // The reason this whole module exists: pdfjs emits in draw order, so a
    // numeric table arrives interleaved.
    const lines = groupIntoLines([item("second", 200, 700), item("first", 50, 700)]);
    expect(lines).toHaveLength(1);
    expect(lines[0].items.map((i) => i.text)).toEqual(["first", "second"]);
  });

  it("keeps a subscript on its own line rather than starting a new one", () => {
    const lines = groupIntoLines([item("CO", 50, 700), { ...item("2", 60, 697), height: 6 }]);
    expect(lines).toHaveLength(1);
  });

  it("separates genuinely different lines", () => {
    expect(groupIntoLines([item("a", 50, 700), item("b", 50, 680)])).toHaveLength(2);
  });

  it("ignores whitespace-only items", () => {
    expect(groupIntoLines([item("   ", 50, 700)])).toHaveLength(0);
  });
});

describe("detectTables", () => {
  it("reads a simple left-aligned table with a header row", () => {
    const items = [
      ...row(700, [
        ["Group", 50],
        ["N", 200],
        ["Mean", 300],
      ]),
      ...row(680, [
        ["Control", 50],
        ["42", 200],
        ["3.1", 300],
      ]),
      ...row(660, [
        ["Treatment", 50],
        ["41", 200],
        ["4.7", 300],
      ]),
    ];
    const [table] = detectTables(3, items);
    expect(table.pageNumber).toBe(3);
    expect(table.grid).toEqual([
      ["Group", "N", "Mean"],
      ["Control", "42", "3.1"],
      ["Treatment", "41", "4.7"],
    ]);
    expect(table.confidence).toBe(1);
  });

  it("keeps a right-aligned numeric column in one column", () => {
    // Clustering start-x alone scatters 1.2 / 10.4 / 100.9 across three
    // boundaries, which is how a value lands in the wrong column.
    const items = [
      item("Study", 50, 700),
      rightItem("Effect", 320, 700),
      item("Alpha", 50, 680),
      rightItem("1.2", 320, 680),
      item("Beta", 50, 660),
      rightItem("10.4", 320, 660),
      item("Gamma", 50, 640),
      rightItem("100.9", 320, 640),
    ];
    const [table] = detectTables(1, items);
    expect(table.grid.map((r) => r[1])).toEqual(["Effect", "1.2", "10.4", "100.9"]);
  });

  it("keeps a cell fragmented by superscripts in one column", () => {
    // The real failure this comes from: `O((log p)^3)` reaches pdfjs as five
    // separate items — a math run, an italic variable, a raised exponent — and
    // clustering their start-x invented a column boundary inside the cell, so
    // every data row had one more cell than its header and the values after it
    // shifted right.
    const complexity = (x: number, y: number): PositionedItem[] => [
      item("O((log", x, y),
      item("p", x + 32, y),
      item(")", x + 40, y),
      { text: "3", x: x + 45, y: y + 4, width: 3, height: 6 },
      item(")", x + 49, y),
    ];

    const items = [
      ...row(700, [
        ["Algorithm", 50],
        ["Qubits", 160],
        ["Gate Count", 240],
        ["Tolerance", 340],
      ]),
      ...row(680, [
        ["Shor", 50],
        ["2000-3000", 160],
      ]),
      ...complexity(240, 680),
      ...row(680, [["Low/Low", 340]]),
      ...row(660, [
        ["Kitaev", 50],
        ["1000-2000", 160],
      ]),
      ...complexity(240, 660),
      ...row(660, [["Medium/Medium", 340]]),
      ...row(640, [
        ["AMPHS", 50],
        ["800-1500", 160],
      ]),
      ...complexity(240, 640),
      ...row(640, [["High/High", 340]]),
    ];

    const [table] = detectTables(8, items);
    expect(table.grid[0]).toHaveLength(4);
    expect(table.grid.every((r) => r.length === 4)).toBe(true);
    // The exponent stays inside its own cell, and the column after it holds the
    // tolerance rather than the tail of the formula.
    expect(table.grid[1][2].replace(/\s+/g, "")).toBe("O((logp)3)");
    expect(table.grid[1][3]).toBe("Low/Low");
    expect(table.grid[3][3]).toBe("High/High");
  });

  it("leaves a missing cell empty rather than shifting the row", () => {
    const items = [
      ...row(700, [
        ["Group", 50],
        ["N", 200],
        ["Mean", 300],
      ]),
      ...row(680, [
        ["Control", 50],
        ["42", 200],
        ["3.1", 300],
      ]),
      // No N reported for this row.
      ...row(660, [
        ["Treatment", 50],
        ["4.7", 300],
      ]),
    ];
    const [table] = detectTables(1, items);
    expect(table.grid[2]).toEqual(["Treatment", "", "4.7"]);
  });

  it("finds two tables separated by prose on one page", () => {
    const first = [
      ...row(700, [
        ["A", 50],
        ["B", 200],
      ]),
      ...row(680, [
        ["1", 50],
        ["2", 200],
      ]),
      ...row(660, [
        ["3", 50],
        ["4", 200],
      ]),
    ];
    const prose = [item("These results are discussed at length below.", 50, 620)];
    const second = [
      ...row(560, [
        ["C", 50],
        ["D", 200],
      ]),
      ...row(540, [
        ["5", 50],
        ["6", 200],
      ]),
      ...row(520, [
        ["7", 50],
        ["8", 200],
      ]),
    ];
    expect(detectTables(1, [...first, ...prose, ...second])).toHaveLength(2);
  });

  it("picks up a caption above the table", () => {
    const items = [
      item("Table 2. Baseline characteristics", 50, 720),
      ...row(700, [
        ["A", 50],
        ["B", 200],
      ]),
      ...row(680, [
        ["1", 50],
        ["2", 200],
      ]),
      ...row(660, [
        ["3", 50],
        ["4", 200],
      ]),
    ];
    expect(detectTables(1, items)[0].caption).toBe("Table 2. Baseline characteristics");
  });

  it("picks up a caption below the table", () => {
    const items = [
      ...row(700, [
        ["A", 50],
        ["B", 200],
      ]),
      ...row(680, [
        ["1", 50],
        ["2", 200],
      ]),
      ...row(660, [
        ["3", 50],
        ["4", 200],
      ]),
      item("Table 3 Effect sizes by subgroup", 50, 640),
    ];
    expect(detectTables(1, items)[0].caption).toBe("Table 3 Effect sizes by subgroup");
  });

  it("finds no table in ordinary two-column prose", () => {
    // False positives are the main risk in this design: a paragraph presented
    // as data is worse than no extraction at all.
    const left = [
      "Mitochondrial dysfunction has been implicated",
      "in a range of neurodegenerative conditions,",
      "with oxidative stress proposed as a shared",
      "mechanism across several disease models.",
    ];
    const right = [
      "Subsequent work has questioned whether the",
      "association is causal, noting that the",
      "observed changes may follow rather than",
      "precede the onset of neuronal loss.",
    ];
    const items = left.flatMap((text, i) => [
      item(text, 50, 700 - i * 20),
      item(right[i], 320, 700 - i * 20),
    ]);
    expect(detectTables(1, items)).toEqual([]);
  });

  it("finds no table in a single aligned pair of lines", () => {
    const items = [
      ...row(700, [
        ["Author", 50],
        ["Year", 200],
      ]),
      ...row(680, [
        ["Lin", 50],
        ["2006", 200],
      ]),
    ];
    expect(detectTables(1, items)).toEqual([]);
  });

  it("returns nothing for an empty page", () => {
    expect(detectTables(1, [])).toEqual([]);
  });
});

describe("columnBands", () => {
  it("merges spans separated by less than a gutter into one column", () => {
    const items = [item("O((log", 240, 680), item("p", 272, 680), item(")", 280, 680)];
    expect(columnBands(items, 11)).toEqual([{ start: 240, end: 285 }]);
  });

  it("splits spans separated by more than a gutter", () => {
    expect(columnBands([item("A", 50, 700), item("B", 200, 700)], 11)).toEqual([
      { start: 50, end: 55 },
      { start: 200, end: 205 },
    ]);
  });
});

describe("tableConfidence", () => {
  it("is 1 for a fully populated, perfectly regular grid", () => {
    expect(
      tableConfidence([
        ["a", "b"],
        ["c", "d"],
      ]),
    ).toBe(1);
  });

  it("falls monotonically as a grid empties out", () => {
    const full = tableConfidence([
      ["a", "b", "c"],
      ["d", "e", "f"],
      ["g", "h", "i"],
    ]);
    const oneGap = tableConfidence([
      ["a", "b", "c"],
      ["d", "e", ""],
      ["g", "h", "i"],
    ]);
    const twoGaps = tableConfidence([
      ["a", "b", "c"],
      ["d", "", ""],
      ["g", "h", ""],
    ]);
    expect(full).toBeGreaterThan(oneGap);
    expect(oneGap).toBeGreaterThan(twoGaps);
  });

  it("is zero for an empty grid", () => {
    expect(tableConfidence([])).toBe(0);
  });
});

describe("tableConfidence: rejecting prose", () => {
  it("scores a grid of sentences near zero even though it is perfectly regular", () => {
    // Occupancy and consistency are both 1.0 here. Only cell length tells the
    // two apart, which is why it is a factor and not a filter bolted on later.
    const prose = [
      ["Mitochondrial dysfunction has been implicated", "Subsequent work has questioned whether"],
      ["in a range of neurodegenerative conditions,", "the association is causal, noting that"],
    ];
    expect(tableConfidence(prose)).toBe(0);
  });

  it("falls as more cells grow into sentences", () => {
    const short = tableConfidence([
      ["Group", "N"],
      ["Control", "42"],
    ]);
    const half = tableConfidence([
      ["Group", "N"],
      ["Control arm with extended follow-up", "42"],
    ]);
    expect(short).toBeGreaterThan(half);
    expect(half).toBeGreaterThan(0);
  });
});
