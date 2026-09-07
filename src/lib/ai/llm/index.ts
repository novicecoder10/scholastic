import { anthropicLlmProvider } from "@/lib/ai/llm/anthropic";
import { groqLlmProvider } from "@/lib/ai/llm/groq";
import { sambanovaLlmProvider } from "@/lib/ai/llm/sambanova";
import { mistralLlmProvider } from "@/lib/ai/llm/mistral";
import { openrouterLlmProvider } from "@/lib/ai/llm/openrouter";
import { geminiLlmProvider } from "@/lib/ai/llm/gemini";
import type { LlmProvider } from "@/lib/ai/llm/types";

/** Shared across every AI feature's "not configured" error message — kept in
 * one place since the list of supported providers keeps growing. */
export const NO_LLM_PROVIDER_MESSAGE =
  "no AI provider is configured (see SETUP.md — supported: ANTHROPIC_API_KEY, GROQ_API_KEY, " +
  "SAMBANOVA_API_KEY, MISTRAL_API_KEY, OPENROUTER_API_KEY, or GOOGLE_API_KEY)";

/**
 * Preference order, live-verified against each real API: Anthropic
 * (dedicated, already-tuned model tiers) > Groq (genuinely free tier, fast,
 * reliable) > SambaNova (works well, bills per-token against the account
 * rather than a true free tier) > Mistral (same — works well, bills
 * per-token) > OpenRouter (free-tier models observed more variable in
 * quality/latency during development) > Gemini (the endpoint/key both work,
 * but observed live to be blocked by a zero free-tier quota on this
 * account's Google Cloud project — kept last since it's the one currently
 * confirmed non-functional, not because Gemini itself is a worse model).
 * Only ONE provider is used per request — this is a static "best available"
 * choice made once per call, not automatic runtime failover between
 * providers if the selected one fails mid-request (each call still retries
 * within itself via `withResilience`/its own retry budget, same as every
 * other external dependency in this app). `null` when none are configured —
 * every AI-feature route checks this and returns a clear 503 rather than
 * crashing, mirroring the embeddings layer's `getActiveEmbeddingProvider()`
 * selection pattern.
 */
export function getActiveLlmProvider(): LlmProvider | null {
  if (anthropicLlmProvider.isConfigured()) return anthropicLlmProvider;
  if (groqLlmProvider.isConfigured()) return groqLlmProvider;
  if (sambanovaLlmProvider.isConfigured()) return sambanovaLlmProvider;
  if (mistralLlmProvider.isConfigured()) return mistralLlmProvider;
  if (openrouterLlmProvider.isConfigured()) return openrouterLlmProvider;
  if (geminiLlmProvider.isConfigured()) return geminiLlmProvider;
  return null;
}

/**
 * Tier-aware selection lives in `lib/capacity/sources.ts` now, where the pool
 * of capacity sources can actually differentiate on it. This module answers
 * only "which keys are in the environment", which is not a tier question — the
 * placeholder that pretended otherwise (and carried the repo's one standing
 * unused-parameter warning for four milestones) has been removed rather than
 * given a contrived use.
 */

export type { LlmProvider, ChatMessage, CompleteParams } from "@/lib/ai/llm/types";
export { anthropicLlmProvider } from "@/lib/ai/llm/anthropic";
export { groqLlmProvider } from "@/lib/ai/llm/groq";
export { sambanovaLlmProvider } from "@/lib/ai/llm/sambanova";
export { mistralLlmProvider } from "@/lib/ai/llm/mistral";
export { openrouterLlmProvider } from "@/lib/ai/llm/openrouter";
export { geminiLlmProvider } from "@/lib/ai/llm/gemini";
