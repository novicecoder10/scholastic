import { describe, it, expect, afterEach } from "vitest";
import { groqLlmProvider } from "@/lib/ai/llm/groq";

// Full HTTP/SSE behavior is covered generically in openAiCompatible.test.ts
// (this provider is a thin config wrapper around that factory) — this file
// only checks the wiring: right env var, right default models.
const ORIGINAL_KEY = process.env.GROQ_API_KEY;

afterEach(() => {
  if (ORIGINAL_KEY === undefined) delete process.env.GROQ_API_KEY;
  else process.env.GROQ_API_KEY = ORIGINAL_KEY;
});

describe("groqLlmProvider", () => {
  it("is not configured without GROQ_API_KEY", () => {
    delete process.env.GROQ_API_KEY;
    expect(groqLlmProvider.isConfigured()).toBe(false);
  });

  it("is configured when GROQ_API_KEY is set", () => {
    process.env.GROQ_API_KEY = "gsk-test";
    expect(groqLlmProvider.isConfigured()).toBe(true);
  });

  it("has distinct default cheap/capable model ids", () => {
    expect(groqLlmProvider.models).toEqual({
      cheap: "openai/gpt-oss-20b",
      capable: "openai/gpt-oss-120b",
    });
  });
});
