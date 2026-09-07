import { createOpenAiCompatibleProvider } from "@/lib/ai/llm/openAiCompatible";

/**
 * Free-tier LLM backend via Google's Gemini OpenAI-compatibility endpoint
 * (`/v1beta/openai/chat/completions`) — lets a Gemini API key (from AI
 * Studio) work through the same OpenAI-chat-completions shape as
 * OpenRouter/Groq. Model ids confirmed valid live (`gemini-2.0-flash` /
 * `gemini-2.0-flash-lite` — some other version strings 404 on this
 * compatibility layer). Override via `GEMINI_MODEL_CHEAP`/
 * `GEMINI_MODEL_CAPABLE` if Google's lineup changes.
 */
export const geminiLlmProvider = createOpenAiCompatibleProvider({
  providerId: "gemini_llm",
  displayName: "Google Gemini",
  baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
  apiKeyEnvVar: "GOOGLE_API_KEY",
  cheapModelEnvVar: "GEMINI_MODEL_CHEAP",
  capableModelEnvVar: "GEMINI_MODEL_CAPABLE",
  defaultCheapModel: "gemini-2.0-flash-lite",
  defaultCapableModel: "gemini-2.0-flash",
});
