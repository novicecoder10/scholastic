import { describe, it, expect } from "vitest";
import { getSimilarWorks } from "@/lib/ai/similarWorks";

describe("getSimilarWorks", () => {
  it("throws when the database isn't configured, before any graceful-degradation attempt", async () => {
    // Unlike the embedding cache (which degrades to "no cache, compute fresh"
    // when the DB is unreachable), the database here IS the corpus being
    // ranked against — there is no meaningful fallback, so this is a hard
    // dependency and should surface as a clear error (mapped to a 503 by the
    // route), not a silent empty result.
    delete process.env.DATABASE_URL;
    await expect(getSimilarWorks("doi:somehash")).rejects.toThrow(/DATABASE_URL/);
  });
});
