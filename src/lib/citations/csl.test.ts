import { describe, it, expect } from "vitest";
import { cslYear, toCsl, toCslName } from "@/lib/citations/csl";
import { bibliographic, work } from "@/lib/citations/fixtures";

describe("toCslName", () => {
  it("splits a plain given/family name", () => {
    expect(toCslName("Jane Smith")).toEqual({ family: "Smith", given: "Jane" });
  });

  it("keeps multi-part given names together", () => {
    expect(toCslName("John Ronald Reuel Tolkien")).toEqual({
      family: "Tolkien",
      given: "John Ronald Reuel",
    });
  });

  it("respects an explicit inverted form", () => {
    expect(toCslName("Smith, Jane")).toEqual({ family: "Smith", given: "Jane" });
  });

  it("treats a corporate author as a literal, never inverting it", () => {
    // "Organization, W." in a bibliography is a visible error; the full name is not.
    expect(toCslName("World Health Organization")).toEqual({
      family: "World Health Organization",
      literal: "World Health Organization",
    });
  });

  it("treats a single-word name as a literal", () => {
    expect(toCslName("Anonymous")).toEqual({ family: "Anonymous", literal: "Anonymous" });
  });

  it("does not throw on an empty name", () => {
    expect(toCslName("   ").family).toBe("Unknown");
  });
});

describe("toCsl", () => {
  it("maps a fully populated work", () => {
    const item = toCsl(work());
    expect(item.type).toBe("article-journal");
    expect(item.volume).toBe("218");
    expect(item.page).toBe("125-134");
    expect(item.issued).toEqual({ "date-parts": [[2019, 3, 4]] });
    expect(item.DOI).toBe("10.1000/xyz");
  });

  it("falls back to the reconciled year when no source gave a full date", () => {
    const item = toCsl(work({ bibliographic: null, year: 2001 }));
    expect(item.issued).toEqual({ "date-parts": [[2001]] });
    expect(cslYear(item)).toBe(2001);
  });

  it("survives a fully-null bibliographic block", () => {
    const item = toCsl(work({ bibliographic: null }));
    expect(item.volume).toBeNull();
    expect(item.page).toBeNull();
    // venue still stands in for the container — it's reconciled separately.
    expect(item["container-title"]).toBe("Journal of Cell Biology");
  });

  it("emits a first page alone when there is no last page", () => {
    expect(toCsl(work({ bibliographic: bibliographic({ lastPage: null }) })).page).toBe("125");
  });

  it("reports no date at all when neither source has one", () => {
    const item = toCsl(work({ bibliographic: null, year: null }));
    expect(item.issued).toBeNull();
    expect(cslYear(item)).toBeNull();
  });

  it("maps an unrecognised source type to a conservative CSL type", () => {
    const item = toCsl(work({ bibliographic: bibliographic({ type: "component" }) }));
    expect(item.type).toBe("document");
  });
});
