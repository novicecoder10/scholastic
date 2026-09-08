import { describe, it, expect, vi, beforeEach } from "vitest";

const isAuthEnabledMock = vi.fn();
vi.mock("@/lib/auth/config", () => ({
  isAuthEnabled: () => isAuthEnabledMock(),
}));

const getBalanceMock = vi.fn();
vi.mock("@/lib/credits/ledger", () => ({
  getBalance: (userId: string) => getBalanceMock(userId),
}));

const selectMock = vi.fn();
vi.mock("@/lib/db/client", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({ where: () => ({ limit: () => selectMock() }) }),
    }),
  }),
}));

import { preflight } from "@/lib/credits/preflight";
import { estimateCredits } from "@/lib/credits/cost";

const USER = { kind: "user" as const, userId: "u1" };

describe("preflight", () => {
  beforeEach(() => {
    isAuthEnabledMock.mockReturnValue(true);
    getBalanceMock.mockReset();
    selectMock.mockReset().mockResolvedValue([]);
  });

  it("does not meter an instance with accounts switched off", async () => {
    // No identity can hold a balance and there is no shared pool to protect:
    // the instance is somebody's own.
    isAuthEnabledMock.mockReturnValue(false);
    const result = await preflight(USER, "summary");
    expect(result).toMatchObject({ allowed: true, metered: false });
    expect(getBalanceMock).not.toHaveBeenCalled();
  });

  it("permits a balance exactly equal to the estimate", async () => {
    getBalanceMock.mockResolvedValue(estimateCredits("summary"));
    expect(await preflight(USER, "summary")).toMatchObject({ allowed: true, metered: true });
  });

  it("refuses one credit below the estimate, naming both figures", async () => {
    getBalanceMock.mockResolvedValue(estimateCredits("synthesis_turn") - 1);
    const result = await preflight(USER, "synthesis_turn");
    expect(result.allowed).toBe(false);
    expect(result.message).toContain(String(result.estimate));
    expect(result.message).toContain(String(result.balance));
    // The refusal has to say what still works, or an empty balance reads as a
    // broken app rather than an empty allowance.
    expect(result.message).toMatch(/free/i);
  });

  it("fails open when the ledger cannot be read", async () => {
    // A commons that refuses service because its bookkeeping is offline is
    // worse than one that occasionally undercounts.
    getBalanceMock.mockRejectedValue(new Error("connection refused"));
    expect(await preflight(USER, "summary")).toMatchObject({ allowed: true, metered: false });
  });

  it("gives an anonymous visitor a flat allowance rather than a balance", async () => {
    const result = await preflight({ kind: "anonymous", sessionId: "s1" }, "summary");
    expect(result).toMatchObject({ allowed: true, metered: true });
    expect(getBalanceMock).not.toHaveBeenCalled();
  });

  it("refuses an anonymous visitor who has spent the allowance", async () => {
    selectMock.mockResolvedValue([{ sessionId: "s1", used: 10_000, periodStartsAt: new Date() }]);
    const result = await preflight({ kind: "anonymous", sessionId: "s1" }, "summary");
    expect(result.allowed).toBe(false);
    expect(result.message).toMatch(/account/i);
  });

  it("resets an anonymous allowance whose period has rolled over", async () => {
    selectMock.mockResolvedValue([
      { sessionId: "s1", used: 10_000, periodStartsAt: new Date("2020-01-01T00:00:00Z") },
    ]);
    expect(await preflight({ kind: "anonymous", sessionId: "s1" }, "summary")).toMatchObject({
      allowed: true,
    });
  });

  it("does not meter a call it cannot attribute to anyone", async () => {
    expect(await preflight(null, "summary")).toMatchObject({ allowed: true, metered: false });
  });
});
