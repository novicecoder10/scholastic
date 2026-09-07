import { createOpenAiCompatibleProvider } from "@/lib/ai/llm/openAiCompatible";

/**
 * LLM backend via SambaNova's OpenAI-chat-completions-compatible API.
 * Unlike Groq/OpenRouter's genuinely free-tier models, SambaNova bills per
 * token against the configured account (real cost, even if currently covered
 * by trial credit) — still auto-detected/used the same way, since it's the
 * user's own key for their own account, but ranked behind the zero-marginal-
 * cost options in `lib/ai/llm/index.ts`'s preference order.
 */
export const sambanovaLlmProvider = createOpenAiCompatibleProvider({
  providerId: "sambanova_llm",
  displayName: "SambaNova",
  baseUrl: "https://api.sambanova.ai/v1/chat/completions",
  apiKeyEnvVar: "SAMBANOVA_API_KEY",
  cheapModelEnvVar: "SAMBANOVA_MODEL_CHEAP",
  capableModelEnvVar: "SAMBANOVA_MODEL_CAPABLE",
  defaultCheapModel: "gemma-4-31B-it",
  defaultCapableModel: "DeepSeek-V3.1",
});
