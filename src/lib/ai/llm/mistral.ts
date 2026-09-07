import { createOpenAiCompatibleProvider } from "@/lib/ai/llm/openAiCompatible";

/**
 * LLM backend via Mistral's own API — already OpenAI-chat-completions-
 * compatible natively (no separate compatibility endpoint needed, unlike
 * Gemini). Bills per token against the configured account like SambaNova,
 * not a genuine free tier like Groq/OpenRouter.
 */
export const mistralLlmProvider = createOpenAiCompatibleProvider({
  providerId: "mistral_llm",
  displayName: "Mistral",
  baseUrl: "https://api.mistral.ai/v1/chat/completions",
  apiKeyEnvVar: "MISTRAL_API_KEY",
  cheapModelEnvVar: "MISTRAL_MODEL_CHEAP",
  capableModelEnvVar: "MISTRAL_MODEL_CAPABLE",
  defaultCheapModel: "ministral-3b-latest",
  defaultCapableModel: "mistral-large-latest",
});
