import { describe, it, expect } from "vitest";
import { missingPairs } from "@/lib/extraction/repository";

const rows = [
  { id: 1, documentId: "doc-a" },
  { id: 2, documentId: "doc-b" },
];
const columns = [{ id: 10 }, { id: 11 }];

describe("missingPairs", () => {
  it("returns the whole grid when nothing has been filled", () => {
    expect(missingPairs(rows, columns, [])).toHaveLength(4);
  });

  it("skips cells already filled, so a refill is not re-paid for", () => {
    const pairs = missingPairs(rows, columns, [
      { rowId: 1, columnId: 10, status: "found" },
      { rowId: 1, columnId: 11, status: "not_reported" },
    ]);
    expect(pairs.map((p) => `${p.rowId}:${p.columnId}`)).toEqual(["2:10", "2:11"]);
  });

  it("treats not_reported as done — it is an answer, not a gap", () => {
    const pairs = missingPairs(rows, columns, [{ rowId: 1, columnId: 10, status: "not_reported" }]);
    expect(pairs.some((p) => p.rowId === 1 && p.columnId === 10)).toBe(false);
  });

  it("retries error cells, which are the only ones that failed", () => {
    const pairs = missingPairs(rows, columns, [{ rowId: 1, columnId: 10, status: "error" }]);
    expect(pairs.some((p) => p.rowId === 1 && p.columnId === 10)).toBe(true);
  });

  it("carries the document id, so a job needs no second lookup", () => {
    expect(missingPairs(rows, columns, [])[0].documentId).toBe("doc-a");
  });
});
