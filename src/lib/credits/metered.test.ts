import { describe, it, expect, vi, beforeEach } from "vitest";

const preflightMock = vi.fn();
vi.mock("@/lib/credits/preflight", () => ({
  preflight: (owner: unknown, feature: string) => preflightMock(owner, feature),
}));

const selectCapacityMock = vi.fn();
vi.mock("@/lib/capacity/sources", () => ({
  selectCapacity: (tier: string) => selectCapacityMock(tier),
}));

const debitMock = vi.fn();
vi.mock("@/lib/credits/spend", () => ({
  debit: (...args: unknown[]) => {
    debitMock(...args);
    return Promise.resolve();
  },
}));

vi.mock("@/lib/auth/owner", () => ({ readOwner: async () => null }));

import { InsufficientCreditsError, meteredLlm } from "@/lib/credits/metered";

const OWNER = { kind: "user" as const, userId: "u1" };

function fakeProvider() {
  return {
    models: { cheap: "cheap", capable: "capable" },
    isConfigured: () => true,
    complete: vi.fn(),
    streamComplete: vi.fn(),
  };
}

describe("meteredLlm", () => {
  beforeEach(() => {
    preflightMock.mockReset().mockResolvedValue({
      allowed: true,
      estimate: 4,
      balance: 100,
      metered: true,
    });
    selectCapacityMock.mockReset().mockResolvedValue({
      provider: fakeProvider(),
      servedSourceId: () => "sponsor-1",
      servedSponsor: () => "Open Science Lab",
    });
    debitMock.mockReset();
  });

  it("throws before any provider is selected when the balance is short", async () => {
    // The one place credits can block a request, and it runs before anything
    // has been spent.
    preflightMock.mockResolvedValue({
      allowed: false,
      estimate: 10,
      balance: 2,
      metered: true,
      message: "not enough",
    });
    await expect(meteredLlm("synthesis_turn", "quality", OWNER)).rejects.toBeInstanceOf(
      InsufficientCreditsError,
    );
    expect(selectCapacityMock).not.toHaveBeenCalled();
  });

  it("returns null, not an error, when no provider is configured", async () => {
    // Callers keep their existing "not configured" 503 path.
    selectCapacityMock.mockResolvedValue(null);
    expect(await meteredLlm("summary", "bulk", OWNER)).toBeNull();
  });

  it("does not debit unless the provider reports usage", async () => {
    // A failed, refused or interrupted call never reaches onUsage, so it is
    // never charged.
    const metered = await meteredLlm("summary", "bulk", OWNER);
    expect(metered).not.toBeNull();
    expect(debitMock).not.toHaveBeenCalled();
  });

  it("debits the actual token counts, against the source that served them", async () => {
    const metered = await meteredLlm("summary", "bulk", OWNER);
    metered!.onUsage({ inputTokens: 1200, outputTokens: 400 });
    expect(debitMock).toHaveBeenCalledWith(
      OWNER,
      "summary",
      "bulk",
      { inputTokens: 1200, outputTokens: 400 },
      "sponsor-1",
    );
  });

  it("still bills the capacity source when the caller is not being metered", async () => {
    // Tokens came out of a real pool whether or not anyone's balance moved, so
    // the source is billed and the user is not.
    preflightMock.mockResolvedValue({ allowed: true, estimate: 4, balance: null, metered: false });
    const metered = await meteredLlm("summary", "bulk", OWNER);
    metered!.onUsage({ inputTokens: 100, outputTokens: 100 });
    expect(debitMock).toHaveBeenCalledWith(
      null,
      "summary",
      "bulk",
      { inputTokens: 100, outputTokens: 100 },
      "sponsor-1",
    );
  });

  it("passes the estimate through so a caller can show it before running", async () => {
    const metered = await meteredLlm("summary", "bulk", OWNER);
    expect(metered!.estimate).toBe(4);
  });
});
