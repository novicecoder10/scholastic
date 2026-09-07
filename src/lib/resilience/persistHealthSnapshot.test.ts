import { describe, it, expect } from "vitest";
import { persistHealthSnapshot } from "@/lib/resilience/persistHealthSnapshot";
import type { ProviderHealthRecord } from "@/lib/resilience/healthStore";

function record(overrides: Partial<ProviderHealthRecord> = {}): ProviderHealthRecord {
  return {
    providerId: "test",
    health: "up",
    circuitState: "closed",
    consecutiveFailures: 0,
    lastSuccessAt: null,
    lastErrorAt: null,
    lastError: null,
    recentLatenciesMs: [100, 200],
    rateLimitRemaining: null,
    ...overrides,
  };
}

describe("persistHealthSnapshot", () => {
  it("never throws, even without a configured database (e.g. this test environment)", () => {
    // DATABASE_URL is not set in the vitest environment; this must degrade
    // silently (log-and-continue), never break the caller — same contract as
    // every other resilience-layer failure mode in this app.
    expect(() => persistHealthSnapshot(record())).not.toThrow();
  });

  it("does not throw for a record with no latency history yet", () => {
    expect(() => persistHealthSnapshot(record({ recentLatenciesMs: [] }))).not.toThrow();
  });
});
