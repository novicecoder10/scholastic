import { describe, it, expect } from "vitest";
import { keepOnlyKnownConcepts } from "@/lib/topics/label";

describe("keepOnlyKnownConcepts", () => {
  const known = new Set(["Genomics", "Oncology"]);

  it("keeps a theme whose concepts all came from the input", () => {
    const themes = [{ label: "Cancer genetics", description: "d", concepts: ["Genomics"] }];
    expect(keepOnlyKnownConcepts(themes, known)).toEqual(themes);
  });

  it("strips a concept the model invented", () => {
    // Not cosmetic: clicking a theme filters by its concepts, so an invented
    // one would match nothing and read as a bug in search.
    const result = keepOnlyKnownConcepts(
      [{ label: "T", description: "d", concepts: ["Genomics", "Proteomics"] }],
      known,
    );
    expect(result[0].concepts).toEqual(["Genomics"]);
  });

  it("drops a theme left with no concepts at all", () => {
    expect(
      keepOnlyKnownConcepts([{ label: "T", description: "d", concepts: ["Invented"] }], known),
    ).toEqual([]);
  });

  it("is exact, not fuzzy — a renamed concept is a different concept", () => {
    expect(
      keepOnlyKnownConcepts([{ label: "T", description: "d", concepts: ["genomics"] }], known),
    ).toEqual([]);
  });
});
