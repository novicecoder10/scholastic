import { describe, it, expect, afterEach } from "vitest";
import { getCitationReasoning, CitationReasoningDisabledError } from "@/lib/ai/citations/reasoning";

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

afterEach(() => {
  for (const key of LLM_PROVIDER_ENV_VARS) {
    const original = ORIGINAL_VALUES[key];
    if (original === undefined) delete process.env[key];
    else process.env[key] = original;
  }
});

describe("getCitationReasoning", () => {
  it("throws CitationReasoningDisabledError without a configured LLM provider, before touching the database", async () => {
    for (const key of LLM_PROVIDER_ENV_VARS) delete process.env[key];
    await expect(getCitationReasoning("10.1/citer", "10.1/cited")).rejects.toThrow(
      CitationReasoningDisabledError,
    );
  });

  it("propagates a database-unavailable failure once a provider is configured (no fallback data source for the cache/abstract lookup)", async () => {
    for (const key of LLM_PROVIDER_ENV_VARS) delete process.env[key];
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    // DATABASE_URL is unset in this test environment — same contract as
    // getCitationEnrichment/getOrCreateSummary, which also need the DB to look
    // things up with no other data source available.
    await expect(getCitationReasoning("10.1/citer", "10.1/cited")).rejects.toThrow();
  });
});
