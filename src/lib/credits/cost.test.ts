import { describe, it, expect } from "vitest";
import { costTable, creditsForUsage, DEFAULT_ESTIMATE, estimateCredits } from "@/lib/credits/cost";

describe("creditsForUsage", () => {
  it("charges nothing when no tokens were consumed", () => {
    // A refused or empty completion is free — the rule that keeps a failed call
    // from costing anything.
    expect(creditsForUsage("bulk", 0, 0)).toBe(0);
  });

  it("charges at least one credit for any real usage", () => {
    // Rounding down would let a stream of tiny calls drain the pool without any
    // balance moving.
    expect(creditsForUsage("bulk", 1, 1)).toBe(1);
  });

  it("charges output more than input at the same volume", () => {
    expect(creditsForUsage("bulk", 10_000, 0)).toBeLessThan(creditsForUsage("bulk", 0, 10_000));
  });

  it("charges the quality tier several times the bulk tier", () => {
    expect(creditsForUsage("quality", 4000, 1000)).toBeGreaterThan(
      creditsForUsage("bulk", 4000, 1000),
    );
  });

  it("rounds up rather than down", () => {
    // 1000 input at 0.5/1k = 0.5 credits, which must not round to zero.
    expect(creditsForUsage("bulk", 1000, 0)).toBe(1);
  });

  it("treats an unknown tier as bulk rather than free", () => {
    expect(creditsForUsage("nonsense", 4000, 1000)).toBe(creditsForUsage("bulk", 4000, 1000));
  });

  it("ignores negative token counts instead of crediting them", () => {
    expect(creditsForUsage("bulk", -5000, 1000)).toBe(creditsForUsage("bulk", 0, 1000));
  });
});

describe("estimateCredits", () => {
  it("gives a synthesis turn a higher estimate than a single-abstract chat", () => {
    expect(estimateCredits("synthesis_turn")).toBeGreaterThan(estimateCredits("chat_turn"));
  });

  it("falls back to a plausible figure rather than zero for an unlisted feature", () => {
    // Zero would let a new feature ship unmetered by omission.
    expect(estimateCredits("some_future_feature")).toBe(DEFAULT_ESTIMATE);
  });

  it("lists every metered feature in the published cost table", () => {
    const features = costTable().map((c) => c.feature);
    expect(features).toContain("summary");
    expect(features).toContain("paraphrase");
    expect(costTable().every((c) => c.estimate > 0)).toBe(true);
  });
});
