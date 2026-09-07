import { describe, it, expect } from "vitest";
import { currentPeriodKey, publicationCredit } from "@/lib/credits/grants";

describe("currentPeriodKey", () => {
  it("is stable within a month and changes across one", () => {
    expect(currentPeriodKey(new Date("2026-03-01T00:00:00Z"))).toBe("2026-03");
    expect(currentPeriodKey(new Date("2026-03-31T23:59:59Z"))).toBe("2026-03");
    expect(currentPeriodKey(new Date("2026-04-01T00:00:00Z"))).toBe("2026-04");
  });

  it("zero-pads the month, so keys sort chronologically as strings", () => {
    expect(currentPeriodKey(new Date("2026-01-05T00:00:00Z"))).toBe("2026-01");
  });
});

describe("publicationCredit", () => {
  it("pays the full rate up to the threshold", () => {
    expect(publicationCredit(0, 25)).toBe(25);
    expect(publicationCredit(-4, 25)).toBe(25);
  });

  it("halves at each step past the threshold", () => {
    expect(publicationCredit(1, 25)).toBe(13);
    expect(publicationCredit(2, 25)).toBe(6);
    expect(publicationCredit(3, 25)).toBe(3);
  });

  it("never pays nothing", () => {
    // A contribution that earns zero reads as "your work doesn't count", which
    // is the opposite of what diminishing returns are for: they exist so a
    // prolific author cannot corner a shared pool, not to dismiss the work.
    expect(publicationCredit(50, 25)).toBe(1);
  });
});
