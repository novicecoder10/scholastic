import { describe, expect, it } from "vitest";
import { attributionHeaders, attributionLine } from "@/lib/capacity/attribution";

describe("attributionHeaders", () => {
  it("names a sponsor who asked to be named", () => {
    expect(attributionHeaders("Open Science Lab")).toEqual({
      "X-Capacity-Sponsor": "Open Science Lab",
    });
  });

  it("says nothing when the capacity was the operator's own", () => {
    expect(attributionHeaders(null)).toEqual({});
  });

  it("strips characters a header cannot carry", () => {
    expect(attributionHeaders("Institut für Physik")).toEqual({
      "X-Capacity-Sponsor": "Institut fr Physik",
    });
  });

  it("omits the header entirely rather than sending an empty one", () => {
    expect(attributionHeaders("東京大学")).toEqual({});
  });
});

describe("attributionLine", () => {
  it("reads as thanks, not as a badge", () => {
    expect(attributionLine("Acme Labs")).toBe("Capacity supported by Acme Labs");
  });

  it("invents no benefactor for an operator-funded instance", () => {
    expect(attributionLine(null)).toBeNull();
  });
});
