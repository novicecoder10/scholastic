import { describe, it, expect } from "vitest";
import { getProviderHealthHistory } from "@/lib/resilience/healthHistory";

describe("getProviderHealthHistory", () => {
  it("throws when the database isn't configured — the route/page callers are responsible for degrading", async () => {
    delete process.env.DATABASE_URL;
    await expect(getProviderHealthHistory()).rejects.toThrow(/DATABASE_URL/);
  });
});
