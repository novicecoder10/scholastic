import { describe, it, expect, afterEach } from "vitest";
import { openrouterLlmProvider } from "@/lib/ai/llm/openrouter";

// Full HTTP/SSE behavior is covered generically in openAiCompatible.test.ts
// (this provider is a thin config wrapper around that factory) — this file
// only checks the wiring: right env var, right default models.
const ORIGINAL_KEY = process.env.OPENROUTER_API_KEY;

afterEach(() => {
  if (ORIGINAL_KEY === undefined) delete process.env.OPENROUTER_API_KEY;
  else process.env.OPENROUTER_API_KEY = ORIGINAL_KEY;
});

describe("openrouterLlmProvider", () => {
  it("is not configured without OPENROUTER_API_KEY", () => {
    delete process.env.OPENROUTER_API_KEY;
    expect(openrouterLlmProvider.isConfigured()).toBe(false);
  });

  it("is configured when OPENROUTER_API_KEY is set", () => {
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    expect(openrouterLlmProvider.isConfigured()).toBe(true);
  });

  it("has distinct default cheap/capable model ids", () => {
    expect(openrouterLlmProvider.models.cheap).toBeTruthy();
    expect(openrouterLlmProvider.models.capable).toBeTruthy();
    expect(openrouterLlmProvider.models.cheap).not.toBe(openrouterLlmProvider.models.capable);
  });
});
