import { describe, it, expect, afterEach } from "vitest";
import { getOrCreateSummary, SummaryFeatureDisabledError } from "@/lib/ai/summary";

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

describe("getOrCreateSummary", () => {
  it("throws SummaryFeatureDisabledError without any LLM provider configured, before touching the database", async () => {
    // DATABASE_URL is also unset in this test environment — this assertion
    // only holds if the configured-check runs before any DB access, which is
    // exactly what makes this feature's disabled-state gracefully observable
    // rather than surfacing as a confusing DB connection error.
    for (const key of LLM_PROVIDER_ENV_VARS) delete process.env[key];
    await expect(getOrCreateSummary("doi:somehash")).rejects.toThrow(SummaryFeatureDisabledError);
  });
});
