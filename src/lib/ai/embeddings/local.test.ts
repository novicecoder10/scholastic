import { describe, it, expect, vi, beforeEach } from "vitest";

const pipelineMock = vi.fn();
vi.mock("@xenova/transformers", () => ({
  pipeline: (...args: unknown[]) => pipelineMock(...args),
}));

// Each test dynamically re-imports the module after vi.resetModules() so the
// module-scope cached pipeline promise (deliberately persisted across calls in
// the real implementation, to avoid reloading the model on every embed() call)
// starts fresh per test instead of leaking state between tests in this file.
async function freshModule() {
  const mod = await import("@/lib/ai/embeddings/local");
  return mod.localEmbeddingProvider;
}

describe("localEmbeddingProvider", () => {
  beforeEach(() => {
    vi.resetModules();
    pipelineMock.mockReset();
  });

  it("is always configured (no credentials required)", async () => {
    const provider = await freshModule();
    expect(provider.isConfigured()).toBe(true);
  });

  it("has a modelId identifying the local backend", async () => {
    const provider = await freshModule();
    expect(provider.modelId).toContain("local:");
  });

  it("returns an empty array for an empty input without loading the model", async () => {
    const provider = await freshModule();
    const result = await provider.embed([]);
    expect(result).toEqual([]);
    expect(pipelineMock).not.toHaveBeenCalled();
  });

  it("returns pooled embeddings from the pipeline, called with mean pooling + normalization", async () => {
    const extractor = vi.fn().mockResolvedValue({ tolist: () => [[0.1, 0.2, 0.3]] });
    pipelineMock.mockResolvedValue(extractor);

    const provider = await freshModule();
    const result = await provider.embed(["hello world"]);

    expect(result).toEqual([[0.1, 0.2, 0.3]]);
    expect(extractor).toHaveBeenCalledWith(["hello world"], { pooling: "mean", normalize: true });
  });

  it("caches the loaded pipeline across multiple embed() calls (loads the model only once)", async () => {
    const extractor = vi.fn().mockResolvedValue({ tolist: () => [[0.1]] });
    pipelineMock.mockResolvedValue(extractor);

    const provider = await freshModule();
    await provider.embed(["first"]);
    await provider.embed(["second"]);

    expect(pipelineMock).toHaveBeenCalledTimes(1);
  });

  it("retries a transient model-load failure before succeeding", async () => {
    const extractor = vi.fn().mockResolvedValue({ tolist: () => [[0.5]] });
    pipelineMock
      .mockRejectedValueOnce(new Error("network blip"))
      .mockRejectedValueOnce(new Error("network blip"))
      .mockResolvedValueOnce(extractor);

    const provider = await freshModule();
    const result = await provider.embed(["hello"]);

    expect(result).toEqual([[0.5]]);
    expect(pipelineMock).toHaveBeenCalledTimes(3);
  });

  it("gives up after repeated model-load failures and allows a later retry", async () => {
    pipelineMock.mockRejectedValue(new Error("persistent failure"));

    const provider = await freshModule();
    await expect(provider.embed(["hello"])).rejects.toThrow("persistent failure");
    expect(pipelineMock).toHaveBeenCalledTimes(3);

    // A subsequent call should retry from scratch rather than replaying the
    // same failed promise forever.
    const extractor = vi.fn().mockResolvedValue({ tolist: () => [[0.9]] });
    pipelineMock.mockReset();
    pipelineMock.mockResolvedValue(extractor);
    const result = await provider.embed(["hello again"]);
    expect(result).toEqual([[0.9]]);
  });
});
