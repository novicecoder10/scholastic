import { describe, it, expect, beforeEach } from "vitest";
import { CircuitBreaker } from "@/lib/resilience/circuitBreaker";

describe("CircuitBreaker", () => {
  let breaker: CircuitBreaker;

  beforeEach(() => {
    breaker = new CircuitBreaker();
  });

  it("stays closed and allows calls while there are no failures", () => {
    expect(breaker.canAttempt("p")).toBe(true);
    breaker.recordSuccess("p");
    expect(breaker.getState("p")).toBe("closed");
    expect(breaker.canAttempt("p")).toBe(true);
  });

  it("trips to open after 5 consecutive failures", () => {
    for (let i = 0; i < 4; i++) {
      breaker.canAttempt("p");
      breaker.recordFailure("p");
    }
    expect(breaker.getState("p")).toBe("closed");

    breaker.recordFailure("p");
    expect(breaker.getState("p")).toBe("open");
  });

  it("trips to open when rolling failure rate over 10 calls is >= 0.8", () => {
    // 8 failures interleaved with 2 successes, none of which are 5 consecutive.
    const outcomes = [true, false, false, true, false, false, false, false, false, false];
    for (const success of outcomes) {
      if (success) breaker.recordSuccess("p");
      else breaker.recordFailure("p");
    }
    expect(breaker.getState("p")).toBe("open");
  });

  it("rejects calls immediately while open, within the cooldown window", () => {
    for (let i = 0; i < 5; i++) breaker.recordFailure("p");
    expect(breaker.getState("p")).toBe("open");
    expect(breaker.canAttempt("p", Date.now())).toBe(false);
  });

  it("transitions open -> half_open after the cooldown elapses, allowing exactly one trial", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 5; i++) breaker.recordFailure("p", t0);
    expect(breaker.getState("p")).toBe("open");

    // Before cooldown (30s default) elapses: still blocked.
    expect(breaker.canAttempt("p", t0 + 10_000)).toBe(false);

    // After cooldown: transitions to half_open and allows the trial.
    expect(breaker.canAttempt("p", t0 + 30_001)).toBe(true);
    expect(breaker.getState("p")).toBe("half_open");

    // A second concurrent call while the trial is in flight must not be let through.
    expect(breaker.canAttempt("p", t0 + 30_002)).toBe(false);
  });

  it("half_open success fully resets the breaker to closed", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 5; i++) breaker.recordFailure("p", t0);
    breaker.canAttempt("p", t0 + 30_001); // -> half_open
    breaker.recordSuccess("p");
    expect(breaker.getState("p")).toBe("closed");
    expect(breaker.getConsecutiveFailures("p")).toBe(0);
  });

  it("half_open failure reopens with a doubled cooldown", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 5; i++) breaker.recordFailure("p", t0);
    breaker.canAttempt("p", t0 + 30_001); // -> half_open, cooldown was 30s
    breaker.recordFailure("p", t0 + 30_001); // trial fails -> open, cooldown doubles to 60s

    expect(breaker.getState("p")).toBe("open");
    // Still within the doubled 60s cooldown from the new openedAt.
    expect(breaker.canAttempt("p", t0 + 30_001 + 59_000)).toBe(false);
    // Past the doubled cooldown, it should allow a trial again.
    expect(breaker.canAttempt("p", t0 + 30_001 + 60_001)).toBe(true);
  });

  it("independently tracks state per provider id", () => {
    for (let i = 0; i < 5; i++) breaker.recordFailure("a");
    expect(breaker.getState("a")).toBe("open");
    expect(breaker.getState("b")).toBe("closed");
  });
});
