import { describe, it, expect, afterEach } from "vitest";
import { geminiLlmProvider } from "@/lib/ai/llm/gemini";

// Full HTTP/SSE behavior is covered generically in openAiCompatible.test.ts
// (this provider is a thin config wrapper around that factory) — this file
// only checks the wiring: right env var, right default models.
const ORIGINAL_KEY = process.env.GOOGLE_API_KEY;

afterEach(() => {
  if (ORIGINAL_KEY === undefined) delete process.env.GOOGLE_API_KEY;
  else process.env.GOOGLE_API_KEY = ORIGINAL_KEY;
});

describe("geminiLlmProvider", () => {
  it("is not configured without GOOGLE_API_KEY", () => {
    delete process.env.GOOGLE_API_KEY;
    expect(geminiLlmProvider.isConfigured()).toBe(false);
  });

  it("is configured when GOOGLE_API_KEY is set", () => {
    process.env.GOOGLE_API_KEY = "test-key";
    expect(geminiLlmProvider.isConfigured()).toBe(true);
  });

  it("has distinct default cheap/capable model ids", () => {
    expect(geminiLlmProvider.models).toEqual({
      cheap: "gemini-2.0-flash-lite",
      capable: "gemini-2.0-flash",
    });
  });
});
