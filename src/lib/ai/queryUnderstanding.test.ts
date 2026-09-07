import { describe, it, expect, vi, beforeEach } from "vitest";

// Provider selection, the credit pre-flight and the usage debit all arrive
// through one seam now, so the mock returns the whole metered handle. A null
// provider is expressed as a null handle, exactly as the real module does.
const getActiveLlmProviderMock = vi.fn();
vi.mock("@/lib/credits/metered", () => ({
  meteredLlm: async () => {
    const provider = getActiveLlmProviderMock();
    return provider ? { provider, onUsage: () => {}, estimate: 1, balance: null } : null;
  },
}));

import { understandQuery } from "@/lib/ai/queryUnderstanding";

function fakeProvider(completeImpl: (params: unknown) => Promise<string>) {
  return {
    models: { cheap: "cheap-model", capable: "capable-model" },
    isConfigured: () => true,
    complete: completeImpl,
    streamComplete: vi.fn(),
  };
}

describe("understandQuery", () => {
  beforeEach(() => {
    getActiveLlmProviderMock.mockReset();
  });

  it("falls back to a literal keyword search when no LLM provider is configured", async () => {
    getActiveLlmProviderMock.mockReturnValue(null);
    const result = await understandQuery("transformers");
    expect(result).toEqual({ action: "search", query: "transformers", mode: "keyword" });
  });

  it("returns a parsed search action from valid JSON output", async () => {
    getActiveLlmProviderMock.mockReturnValue(
      fakeProvider(async () =>
        JSON.stringify({ action: "search", query: "transformer scaling laws", mode: "semantic" }),
      ),
    );
    const result = await understandQuery("papers that challenge transformer scaling laws");
    expect(result).toEqual({
      action: "search",
      query: "transformer scaling laws",
      mode: "semantic",
    });
  });

  it("returns a parsed clarify action from valid JSON output", async () => {
    getActiveLlmProviderMock.mockReturnValue(
      fakeProvider(async () =>
        JSON.stringify({ action: "clarify", question: "Which field are you interested in?" }),
      ),
    );
    const result = await understandQuery("transformers");
    expect(result).toEqual({ action: "clarify", question: "Which field are you interested in?" });
  });

  it("strips markdown code fences before parsing (defensive against non-compliant output)", async () => {
    getActiveLlmProviderMock.mockReturnValue(
      fakeProvider(
        async () =>
          "```json\n" +
          JSON.stringify({ action: "search", query: "crispr", mode: "keyword" }) +
          "\n```",
      ),
    );
    const result = await understandQuery("crispr");
    expect(result).toEqual({ action: "search", query: "crispr", mode: "keyword" });
  });

  it("falls back to literal search when the LLM output isn't valid JSON", async () => {
    getActiveLlmProviderMock.mockReturnValue(
      fakeProvider(async () => "Sure, here is a search: transformers"),
    );
    const result = await understandQuery("transformers");
    expect(result).toEqual({ action: "search", query: "transformers", mode: "keyword" });
  });

  it("falls back to literal search when the JSON doesn't match either expected shape", async () => {
    getActiveLlmProviderMock.mockReturnValue(
      fakeProvider(async () => JSON.stringify({ action: "unknown" })),
    );
    const result = await understandQuery("transformers");
    expect(result).toEqual({ action: "search", query: "transformers", mode: "keyword" });
  });

  it("falls back to literal search when the LLM call throws", async () => {
    getActiveLlmProviderMock.mockReturnValue(
      fakeProvider(async () => {
        throw new Error("upstream down");
      }),
    );
    const result = await understandQuery("transformers");
    expect(result).toEqual({ action: "search", query: "transformers", mode: "keyword" });
  });

  it("includes prior clarification turns in the prompt sent to the model", async () => {
    let capturedContent = "";
    getActiveLlmProviderMock.mockReturnValue(
      fakeProvider(async (params: unknown) => {
        capturedContent = (params as { messages: { content: string }[] }).messages[0].content;
        return JSON.stringify({ action: "search", query: "AI transformers", mode: "keyword" });
      }),
    );

    await understandQuery("transformers", [
      { question: "AI models or electrical transformers?", answer: "AI models" },
    ]);

    expect(capturedContent).toContain("AI models or electrical transformers?");
    expect(capturedContent).toContain("AI models");
  });
});
