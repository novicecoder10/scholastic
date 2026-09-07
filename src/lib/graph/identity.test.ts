import { describe, it, expect } from "vitest";
import { isUnresolved, resolveRef } from "@/lib/graph/identity";

describe("resolveRef", () => {
  it("uses the DOI with no lookup at all", () => {
    // Most citation refs carry a DOI, which is why the feared per-node lookup
    // cost largely does not exist.
    expect(resolveRef({ doi: "10.1/ABC", title: "A", year: 2000 })).toMatchObject({
      workKey: "doi:10.1/abc",
      resolved: true,
    });
  });

  it("normalises a DOI URL the same way the rest of the app does", () => {
    // So a graph node and a search result for the same paper share an identity.
    expect(resolveRef({ doi: "https://doi.org/10.1/ABC", title: null, year: null }).workKey).toBe(
      "doi:10.1/abc",
    );
    expect(resolveRef({ doi: "doi:10.1/abc", title: null, year: null }).workKey).toBe("doi:10.1/abc");
  });

  it("marks a DOI-less ref unresolved", () => {
    const resolved = resolveRef({ doi: null, title: "Some paper", year: 1998 });
    expect(resolved.resolved).toBe(false);
    expect(isUnresolved(resolved.workKey)).toBe(true);
  });

  it("hashes title and year into a stable id", () => {
    const a = resolveRef({ doi: null, title: "Some paper", year: 1998 }).workKey;
    const b = resolveRef({ doi: null, title: "  SOME PAPER  ", year: 1998 }).workKey;
    expect(a).toBe(b);
  });

  it("distinguishes two different DOI-less refs", () => {
    const a = resolveRef({ doi: null, title: "Paper one", year: 1998 }).workKey;
    const b = resolveRef({ doi: null, title: "Paper two", year: 1998 }).workKey;
    expect(a).not.toBe(b);
  });

  it("never claims an unresolved ref is a known work", () => {
    // `unresolved:` rather than the app's `title:` shape, which means "a work we
    // have seen and normalised".
    expect(resolveRef({ doi: null, title: "x", year: null }).workKey.startsWith("title:")).toBe(
      false,
    );
  });

  it("treats an empty DOI string as absent", () => {
    expect(resolveRef({ doi: "  ", title: "x", year: null }).resolved).toBe(false);
  });
});
