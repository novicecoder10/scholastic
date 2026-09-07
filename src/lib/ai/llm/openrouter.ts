import { createOpenAiCompatibleProvider } from "@/lib/ai/llm/openAiCompatible";

/**
 * Free-tier LLM backend via OpenRouter's OpenAI-chat-completions-compatible
 * API. Selected as a fallback behind Anthropic/Groq/Gemini (see
 * `lib/ai/llm/index.ts`) when only `OPENROUTER_API_KEY` is configured.
 *
 * OpenRouter's free-model roster changes over time — these defaults were
 * live-verified (real API calls, `cost: 0`) to return clean, complete output
 * rather than burning their whole token budget on hidden reasoning with no
 * visible content (a real behavior seen from some other free reasoning
 * models during verification). Override via `OPENROUTER_MODEL_CHEAP`/
 * `OPENROUTER_MODEL_CAPABLE` if they stop working.
 */
export const openrouterLlmProvider = createOpenAiCompatibleProvider({
  providerId: "openrouter_llm",
  displayName: "OpenRouter",
  baseUrl: "https://openrouter.ai/api/v1/chat/completions",
  apiKeyEnvVar: "OPENROUTER_API_KEY",
  cheapModelEnvVar: "OPENROUTER_MODEL_CHEAP",
  capableModelEnvVar: "OPENROUTER_MODEL_CAPABLE",
  defaultCheapModel: "google/gemma-4-26b-a4b-it:free",
  defaultCapableModel: "nvidia/nemotron-3-ultra-550b-a55b:free",
});
