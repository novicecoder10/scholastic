import { describe, it, expect } from "vitest";
import { cosineSimilarity } from "@/lib/ai/similarity";

describe("cosineSimilarity", () => {
  it("is 1 for identical vectors", () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 10);
  });

  it("is 0 for orthogonal vectors", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 10);
  });

  it("is -1 for opposite vectors", () => {
    expect(cosineSimilarity([1, 2], [-1, -2])).toBeCloseTo(-1, 10);
  });

  it("is scale-invariant", () => {
    const a = cosineSimilarity([1, 2, 3], [4, 5, 6]);
    const b = cosineSimilarity([10, 20, 30], [4, 5, 6]);
    expect(a).toBeCloseTo(b, 10);
  });

  it("returns 0 for a zero-magnitude vector instead of dividing by zero", () => {
    expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0);
    expect(Number.isNaN(cosineSimilarity([0, 0, 0], [1, 2, 3]))).toBe(false);
  });
});
