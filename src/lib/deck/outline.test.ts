import { describe, expect, it } from "vitest";
import {
  bulletSegments,
  collectDeckWorkKeys,
  parseOutline,
  remapCitations,
  validateOutline,
} from "@/lib/deck/outline";

const ALLOWED = ["doi:10.1/a", "doi:10.1/b"];

describe("parseOutline", () => {
  it("reads headings as slides and dashes as their bullets", () => {
    const slides = parseOutline("## One\n- first\n- second\n## Two\n- third");
    expect(slides).toEqual([
      { title: "One", bullets: ["first", "second"] },
      { title: "Two", bullets: ["third"] },
    ]);
  });

  it("accepts any heading level and any bullet character", () => {
    const slides = parseOutline("# One\n* star\n• dot\n- dash");
    expect(slides[0].bullets).toEqual(["star", "dot", "dash"]);
  });

  it("ignores prose the model wrapped around the outline", () => {
    const slides = parseOutline("Here is your deck:\n\n## One\n- a claim\n\nHope that helps!");
    expect(slides).toEqual([{ title: "One", bullets: ["a claim"] }]);
  });

  it("drops bullets that arrive before any slide heading rather than inventing one", () => {
    expect(parseOutline("- an orphan claim\n## One\n- a placed claim")).toEqual([
      { title: "One", bullets: ["a placed claim"] },
    ]);
  });
});

describe("validateOutline", () => {
  it("keeps a bullet that cites a supplied work", () => {
    const outline = validateOutline("## Findings\n- Yields rose [[doi:10.1/a]].", ALLOWED);
    expect(outline.slides).toHaveLength(1);
    expect(outline.slides[0].bullets[0].citations).toEqual(["doi:10.1/a"]);
    expect(outline.droppedUncited).toBe(0);
  });

  it("deletes an uncited bullet", () => {
    const outline = validateOutline(
      "## Findings\n- Yields rose [[doi:10.1/a]].\n- This matters a great deal.",
      ALLOWED,
    );
    expect(outline.slides[0].bullets).toHaveLength(1);
    expect(outline.droppedUncited).toBe(1);
  });

  it("strips a citation naming a work outside the supplied set", () => {
    const outline = validateOutline(
      "## Findings\n- Two studies agree [[doi:10.1/a]] [[doi:10.9/ghost]].",
      ALLOWED,
    );
    expect(outline.slides[0].bullets[0].citations).toEqual(["doi:10.1/a"]);
    expect(outline.slides[0].bullets[0].text).not.toContain("ghost");
    expect(outline.droppedForeign).toBe(1);
  });

  it("deletes a bullet whose only citation was foreign, because it is now uncited", () => {
    const outline = validateOutline("## Findings\n- A bold claim [[doi:10.9/ghost]].", ALLOWED);
    expect(outline.slides).toHaveLength(0);
    expect(outline.droppedForeign).toBe(1);
    expect(outline.droppedUncited).toBe(1);
  });

  it("deletes a slide whose every bullet was dropped", () => {
    const outline = validateOutline(
      "## Kept\n- Cited [[doi:10.1/a]].\n## Emptied\n- Uncited.\n- Also uncited.",
      ALLOWED,
    );
    expect(outline.slides.map((s) => s.title)).toEqual(["Kept"]);
    expect(outline.droppedSlides).toBe(1);
  });

  it("returns an empty deck rather than an uncited one when nothing survives", () => {
    const outline = validateOutline("## One\n- Nothing cited here.", ALLOWED);
    expect(outline.slides).toEqual([]);
  });
});

describe("collectDeckWorkKeys", () => {
  it("orders by first appearance across slides and de-duplicates", () => {
    const outline = validateOutline(
      "## One\n- x [[doi:10.1/b]]\n## Two\n- y [[doi:10.1/a]]\n- z [[doi:10.1/b]]",
      ALLOWED,
    );
    expect(collectDeckWorkKeys(outline)).toEqual(["doi:10.1/b", "doi:10.1/a"]);
  });
});

describe("bulletSegments", () => {
  it("splits text and citation runs in order", () => {
    const outline = validateOutline("## One\n- Before [[doi:10.1/a]] after.", ALLOWED);
    expect(bulletSegments(outline.slides[0].bullets[0])).toEqual([
      { kind: "text", value: "Before " },
      { kind: "citation", workKey: "doi:10.1/a" },
      { kind: "text", value: " after." },
    ]);
  });
});

describe("remapCitations", () => {
  const tags = new Map([
    ["S1", "doi:10.1/a"],
    ["S2", "doi:10.1/b"],
  ]);

  it("rewrites tags to workKeys in both the markers and the citation list", () => {
    const outline = remapCitations(
      validateOutline("## One\n- Yields rose [[S1]] and fell [[S2]].", tags.keys()),
      tags,
    );
    expect(outline.slides[0].bullets[0].text).toBe(
      "Yields rose [[doi:10.1/a]] and fell [[doi:10.1/b]].",
    );
    expect(outline.slides[0].bullets[0].citations).toEqual(["doi:10.1/a", "doi:10.1/b"]);
  });

  it("leaves the drop counts alone — remapping is not a second guard", () => {
    const validated = validateOutline("## One\n- Cited [[S1]].\n- Uncited.", tags.keys());
    expect(remapCitations(validated, tags).droppedUncited).toBe(validated.droppedUncited);
  });

  it("carries the deck ordering through, so the reference list still agrees", () => {
    const outline = remapCitations(
      validateOutline("## One\n- x [[S2]]\n## Two\n- y [[S1]]", tags.keys()),
      tags,
    );
    expect(collectDeckWorkKeys(outline)).toEqual(["doi:10.1/b", "doi:10.1/a"]);
  });
});
