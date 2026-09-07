import { describe, it, expect, afterEach } from "vitest";
import { getActiveLlmProvider } from "@/lib/ai/llm";

const LLM_PROVIDER_ENV_VARS = [
  "ANTHROPIC_API_KEY",
  "GROQ_API_KEY",
  "SAMBANOVA_API_KEY",
  "MISTRAL_API_KEY",
  "OPENROUTER_API_KEY",
  "GOOGLE_API_KEY",
] as const;
const ORIGINAL_VALUES = Object.fromEntries(
  LLM_PROVIDER_ENV_VARS.map((key) => [key, process.env[key]]),
);

function clearAll() {
  for (const key of LLM_PROVIDER_ENV_VARS) delete process.env[key];
}

afterEach(() => {
  for (const key of LLM_PROVIDER_ENV_VARS) {
    const original = ORIGINAL_VALUES[key];
    if (original === undefined) delete process.env[key];
    else process.env[key] = original;
  }
});

describe("getActiveLlmProvider", () => {
  it("returns null when no provider is configured", () => {
    clearAll();
    expect(getActiveLlmProvider()).toBeNull();
  });

  it("returns the Gemini provider when only GOOGLE_API_KEY is set (last in preference order)", () => {
    clearAll();
    process.env.GOOGLE_API_KEY = "test-key";
    expect(getActiveLlmProvider()?.models.cheap).toBe("gemini-2.0-flash-lite");
  });

  it("returns the OpenRouter provider when only OPENROUTER_API_KEY is set", () => {
    clearAll();
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    expect(getActiveLlmProvider()?.models.cheap).toContain("free");
  });

  it("returns the Mistral provider when only MISTRAL_API_KEY is set", () => {
    clearAll();
    process.env.MISTRAL_API_KEY = "test-key";
    expect(getActiveLlmProvider()?.models.capable).toBe("mistral-large-latest");
  });

  it("returns the SambaNova provider when only SAMBANOVA_API_KEY is set", () => {
    clearAll();
    process.env.SAMBANOVA_API_KEY = "test-key";
    expect(getActiveLlmProvider()?.models.capable).toBe("DeepSeek-V3.1");
  });

  it("returns the Groq provider when only GROQ_API_KEY is set", () => {
    clearAll();
    process.env.GROQ_API_KEY = "gsk-test";
    expect(getActiveLlmProvider()?.models.capable).toBe("openai/gpt-oss-120b");
  });

  it("returns the Anthropic provider when only ANTHROPIC_API_KEY is set", () => {
    clearAll();
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    expect(getActiveLlmProvider()?.models.capable).toBe("claude-sonnet-5");
  });

  it("prefers Anthropic > Groq > SambaNova > Mistral > OpenRouter > Gemini when all are configured", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    process.env.GROQ_API_KEY = "gsk-test";
    process.env.SAMBANOVA_API_KEY = "test-key";
    process.env.MISTRAL_API_KEY = "test-key";
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    process.env.GOOGLE_API_KEY = "test-key";
    expect(getActiveLlmProvider()?.models.cheap).toBe("claude-haiku-4-5-20251001");
  });

  it("prefers Groq over everything except Anthropic", () => {
    clearAll();
    process.env.GROQ_API_KEY = "gsk-test";
    process.env.SAMBANOVA_API_KEY = "test-key";
    process.env.MISTRAL_API_KEY = "test-key";
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    process.env.GOOGLE_API_KEY = "test-key";
    expect(getActiveLlmProvider()?.models.cheap).toBe("openai/gpt-oss-20b");
  });

  it("prefers SambaNova over Mistral, OpenRouter, and Gemini", () => {
    clearAll();
    process.env.SAMBANOVA_API_KEY = "test-key";
    process.env.MISTRAL_API_KEY = "test-key";
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    process.env.GOOGLE_API_KEY = "test-key";
    expect(getActiveLlmProvider()?.models.cheap).toBe("gemma-4-31B-it");
  });

  it("prefers Mistral over OpenRouter and Gemini", () => {
    clearAll();
    process.env.MISTRAL_API_KEY = "test-key";
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    process.env.GOOGLE_API_KEY = "test-key";
    expect(getActiveLlmProvider()?.models.cheap).toBe("ministral-3b-latest");
  });

  it("prefers OpenRouter over Gemini", () => {
    clearAll();
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    process.env.GOOGLE_API_KEY = "test-key";
    expect(getActiveLlmProvider()?.models.cheap).toContain("free");
  });
});
