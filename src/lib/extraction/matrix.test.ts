import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/documents/retrieve", () => ({ retrieveChunks: vi.fn() }));
vi.mock("@/lib/credits/metered", () => ({ meteredLlm: vi.fn() }));

import {
  CELL_CONCURRENCY,
  fillCells,
  type CellJob,
  type CellResult,
} from "@/lib/extraction/matrix";

const column = { id: 1, label: "sample size", hint: null, valueType: "number" };

function jobs(count: number): CellJob[] {
  return Array.from({ length: count }, (_, i) => ({
    rowId: i,
    documentId: `doc-${i}`,
    column,
  }));
}

describe("fillCells", () => {
  it("never exceeds the concurrency limit", async () => {
    // A wide matrix opening fifty simultaneous calls trips the provider's rate
    // limit and turns a slow fill into a failed one.
    let inFlight = 0;
    let peak = 0;
    const results: CellResult[] = [];
    await fillCells(
      jobs(12),
      async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight -= 1;
        results.push({} as CellResult);
      },
      3,
    );
    expect(peak).toBeLessThanOrEqual(3);
    expect(results).toHaveLength(12);
  });

  it("persists every cell even when one of them throws on save", async () => {
    // A half-filled matrix is useful; an exception that discards the other 117
    // results is not.
    const saved: number[] = [];
    await fillCells(
      jobs(5),
      async (job) => {
        if (job.rowId === 2) throw new Error("save failed");
        saved.push(job.rowId);
      },
      2,
    );
    expect(saved).toEqual([0, 1, 3, 4]);
  });

  it("does nothing, and does not hang, for an empty job list", async () => {
    await expect(fillCells([], async () => {})).resolves.toBeUndefined();
  });

  it("defaults to a concurrency small enough not to trip a provider", () => {
    expect(CELL_CONCURRENCY).toBeLessThanOrEqual(8);
  });
});
