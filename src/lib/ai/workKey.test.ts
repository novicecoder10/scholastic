import { describe, it, expect } from "vitest";
import { getWorkKey, type WorkIdentity } from "@/lib/ai/workKey";

function identity(overrides: Partial<WorkIdentity>): WorkIdentity {
  return {
    doi: null,
    title: "A Paper About Transformers",
    year: 2020,
    authors: [{ name: "Jane Smith" }],
    venue: "NeurIPS",
    ...overrides,
  };
}

describe("getWorkKey", () => {
  it("is stable across differently-cased/prefixed DOIs for the same work", () => {
    const a = getWorkKey(identity({ doi: "10.1000/ABC123" }));
    const b = getWorkKey(identity({ doi: "https://doi.org/10.1000/abc123" }));
    expect(a).toBe(b);
  });

  it("differs for different DOIs", () => {
    const a = getWorkKey(identity({ doi: "10.1000/abc123" }));
    const b = getWorkKey(identity({ doi: "10.1000/xyz789" }));
    expect(a).not.toBe(b);
  });

  it("is a uniform, URL-safe opaque token with no slashes (DOI is hashed, not embedded raw)", () => {
    const key = getWorkKey(identity({ doi: "10.1109/iccv48922.2021.00986" }));
    expect(key).not.toContain("/");
    expect(key).toMatch(/^doi:[0-9a-f]{64}$/);
  });

  it("falls back to a content hash of title+year+author+venue when DOI-less", () => {
    const key = getWorkKey(identity({ doi: null }));
    expect(key).toMatch(/^hash:[0-9a-f]{64}$/);
  });

  it("gives the same key for the same DOI-less work described identically twice", () => {
    const a = getWorkKey(identity({ doi: null }));
    const b = getWorkKey(identity({ doi: null }));
    expect(a).toBe(b);
  });

  it("gives a different key when the title differs, DOI-less", () => {
    const a = getWorkKey(identity({ doi: null, title: "A Paper About Transformers" }));
    const b = getWorkKey(identity({ doi: null, title: "A Completely Different Paper" }));
    expect(a).not.toBe(b);
  });

  it("gives a different key when the venue differs, DOI-less (same author/year/title)", () => {
    const a = getWorkKey(identity({ doi: null, venue: "NeurIPS" }));
    const b = getWorkKey(identity({ doi: null, venue: "ICML" }));
    expect(a).not.toBe(b);
  });

  it("gives a different key when the first author differs, DOI-less", () => {
    const a = getWorkKey(identity({ doi: null, authors: [{ name: "Jane Smith" }] }));
    const b = getWorkKey(identity({ doi: null, authors: [{ name: "John Doe" }] }));
    expect(a).not.toBe(b);
  });

  it("handles missing year/venue/authors without throwing", () => {
    expect(() =>
      getWorkKey(identity({ doi: null, year: null, venue: null, authors: [] })),
    ).not.toThrow();
  });

  it("DOI and DOI-less keys never collide with each other (distinct prefixes)", () => {
    const doiKey = getWorkKey(identity({ doi: "10.1000/abc123" }));
    const hashKey = getWorkKey(identity({ doi: null }));
    expect(doiKey.startsWith("doi:")).toBe(true);
    expect(hashKey.startsWith("hash:")).toBe(true);
  });
});
