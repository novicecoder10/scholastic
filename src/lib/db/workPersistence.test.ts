import { describe, it, expect } from "vitest";
import { persistWorks, isLikelySameWork } from "@/lib/db/workPersistence";
import type { CanonicalWork } from "@/lib/types/work";

function canonicalWork(overrides: Partial<CanonicalWork> = {}): CanonicalWork {
  return {
    id: "1",
    workKey: "test-key",
    doi: null,
    title: "A Paper",
    abstract: null,
    authors: [],
    year: 2020,
    venue: null,
    citationCount: 0,
    isOpenAccess: false,
    pdfUrl: null,
    landingPageUrl: null,
    sources: [{ sourceId: "test", sourceRecordId: "1", citationCount: 0 }],
    bibliographic: null,
    topics: [],
    score: 0,
    ...overrides,
  };
}

describe("isLikelySameWork", () => {
  it("trusts the match when either work has no abstract to compare (no signal available)", () => {
    expect(isLikelySameWork({ abstract: null }, { abstract: "Some abstract text." })).toBe(true);
    expect(isLikelySameWork({ abstract: "Some abstract text." }, { abstract: null })).toBe(true);
    expect(isLikelySameWork({ abstract: null }, { abstract: null })).toBe(true);
  });

  it("treats identical abstracts as the same work", () => {
    const abstract =
      "We propose a new hierarchical Transformer whose representation is computed with shifted windows.";
    expect(isLikelySameWork({ abstract }, { abstract })).toBe(true);
  });

  it("treats near-identical abstracts (minor formatting drift across providers) as the same work", () => {
    const a = "We propose a new hierarchical Transformer for general-purpose vision backbones.";
    const b = "We propose a new hierarchical transformer for general purpose vision backbones";
    expect(isLikelySameWork({ abstract: a }, { abstract: b })).toBe(true);
  });

  it("treats substantially different abstracts sharing a workKey as a collision, not the same work", () => {
    const a =
      "We introduce Adam, an algorithm for first-order gradient-based optimization of stochastic objective functions.";
    const b =
      "We describe a suite of statistical learning methods including decision trees, boosting, and support vector machines.";
    expect(isLikelySameWork({ abstract: a }, { abstract: b })).toBe(false);
  });
});

describe("persistWorks", () => {
  it("never throws, even without a configured database (e.g. this test environment)", () => {
    // DATABASE_URL is not set in the vitest environment (same convention as
    // persistHealthSnapshot.test.ts) — persisting must degrade silently.
    expect(() => persistWorks([canonicalWork()])).not.toThrow();
  });

  it("never throws for an empty result set", () => {
    expect(() => persistWorks([])).not.toThrow();
  });

  it("never throws for a DOI-less work (hash-key path)", () => {
    expect(() => persistWorks([canonicalWork({ doi: null })])).not.toThrow();
  });
});
