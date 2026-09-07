import { describe, it, expect, afterEach } from "vitest";
import { mistralLlmProvider } from "@/lib/ai/llm/mistral";

// Full HTTP/SSE behavior is covered generically in openAiCompatible.test.ts
// (this provider is a thin config wrapper around that factory) — this file
// only checks the wiring: right env var, right default models.
const ORIGINAL_KEY = process.env.MISTRAL_API_KEY;

afterEach(() => {
  if (ORIGINAL_KEY === undefined) delete process.env.MISTRAL_API_KEY;
  else process.env.MISTRAL_API_KEY = ORIGINAL_KEY;
});

describe("mistralLlmProvider", () => {
  it("is not configured without MISTRAL_API_KEY", () => {
    delete process.env.MISTRAL_API_KEY;
    expect(mistralLlmProvider.isConfigured()).toBe(false);
  });

  it("is configured when MISTRAL_API_KEY is set", () => {
    process.env.MISTRAL_API_KEY = "test-key";
    expect(mistralLlmProvider.isConfigured()).toBe(true);
  });

  it("has distinct default cheap/capable model ids", () => {
    expect(mistralLlmProvider.models).toEqual({
      cheap: "ministral-3b-latest",
      capable: "mistral-large-latest",
    });
  });
});
