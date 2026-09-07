import { describe, it, expect, afterEach } from "vitest";
import { sambanovaLlmProvider } from "@/lib/ai/llm/sambanova";

// Full HTTP/SSE behavior is covered generically in openAiCompatible.test.ts
// (this provider is a thin config wrapper around that factory) — this file
// only checks the wiring: right env var, right default models.
const ORIGINAL_KEY = process.env.SAMBANOVA_API_KEY;

afterEach(() => {
  if (ORIGINAL_KEY === undefined) delete process.env.SAMBANOVA_API_KEY;
  else process.env.SAMBANOVA_API_KEY = ORIGINAL_KEY;
});

describe("sambanovaLlmProvider", () => {
  it("is not configured without SAMBANOVA_API_KEY", () => {
    delete process.env.SAMBANOVA_API_KEY;
    expect(sambanovaLlmProvider.isConfigured()).toBe(false);
  });

  it("is configured when SAMBANOVA_API_KEY is set", () => {
    process.env.SAMBANOVA_API_KEY = "test-key";
    expect(sambanovaLlmProvider.isConfigured()).toBe(true);
  });

  it("has distinct default cheap/capable model ids", () => {
    expect(sambanovaLlmProvider.models).toEqual({
      cheap: "gemma-4-31B-it",
      capable: "DeepSeek-V3.1",
    });
  });
});
