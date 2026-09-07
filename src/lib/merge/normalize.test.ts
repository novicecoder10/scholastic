import { describe, expect, it } from "vitest";
import { normalizeDoi } from "@/lib/merge/normalize";

describe("normalizeDoi", () => {
  it("lowercases and trims", () => {
    expect(normalizeDoi("  10.1038/NBT.3117 ")).toBe("10.1038/nbt.3117");
  });

  it("strips a doi.org prefix in either form", () => {
    expect(normalizeDoi("https://doi.org/10.1/a")).toBe("10.1/a");
    expect(normalizeDoi("http://dx.doi.org/10.1/a")).toBe("10.1/a");
  });

  it("is null for nothing", () => {
    expect(normalizeDoi(null)).toBeNull();
    expect(normalizeDoi("")).toBeNull();
  });

  it("is null for a value that is not a string at all", () => {
    // Every provider parses a third-party payload, and a repeated XML element
    // arrives here as an array however carefully the mapper is typed. arXiv
    // really serves such records, and this used to throw
    // "doi.trim is not a function" from inside clusterWorks — failing the
    // entire merged search over one malformed entry.
    expect(normalizeDoi(["10.1/a", "10.1/a"] as never)).toBeNull();
    expect(normalizeDoi(42 as never)).toBeNull();
  });
});
