import { describe, it, expect, vi } from "vitest";
import { getOrComputeEmbeddings } from "@/lib/ai/embeddings/cache";
import type { EmbeddingProvider } from "@/lib/ai/embeddings/types";

function fakeProvider(embedImpl: (texts: string[]) => Promise<number[][]>): EmbeddingProvider {
  return {
    modelId: "fake:test-model",
    isConfigured: () => true,
    embed: embedImpl,
  };
}

describe("getOrComputeEmbeddings", () => {
  it("returns an empty map for an empty input without calling the provider", async () => {
    const embed = vi.fn();
    const result = await getOrComputeEmbeddings([], fakeProvider(embed));
    expect(result.size).toBe(0);
    expect(embed).not.toHaveBeenCalled();
  });

  it("computes an embedding per item and maps it back to the correct workKey, preserving order", async () => {
    const embed = vi.fn(async (texts: string[]) => texts.map((t) => [t.length]));
    const result = await getOrComputeEmbeddings(
      [
        { workKey: "a", text: "short" },
        { workKey: "b", text: "a much longer text" },
      ],
      fakeProvider(embed),
    );

    expect(result.get("a")).toEqual([5]);
    expect(result.get("b")).toEqual([18]);
  });

  it("degrades gracefully (never throws) when the database is unavailable — DATABASE_URL is unset in this test environment", async () => {
    // Same contract as every other DB-backed cache in this app: a missing DB
    // means "no cache," not a hard failure. Every item still gets computed via
    // the provider and returned to the caller.
    const embed = vi.fn(async (texts: string[]) => texts.map(() => [1, 2, 3]));
    await expect(
      getOrComputeEmbeddings([{ workKey: "x", text: "hello" }], fakeProvider(embed)),
    ).resolves.toEqual(new Map([["x", [1, 2, 3]]]));
    expect(embed).toHaveBeenCalledTimes(1);
  });
});
