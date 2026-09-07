import { createOpenAiCompatibleProvider } from "@/lib/ai/llm/openAiCompatible";

/**
 * Free-tier LLM backend via Groq's OpenAI-chat-completions-compatible API —
 * genuinely fast inference (Groq's LPU hardware) on real open-weight models.
 * Defaults live-verified against the real API. Override via
 * `GROQ_MODEL_CHEAP`/`GROQ_MODEL_CAPABLE` if Groq's model lineup changes.
 *
 * `llama-3.1-8b-instant`/`llama-3.3-70b-versatile` (the original defaults)
 * were retired from Groq's lineup and now 404 — replaced with
 * `openai/gpt-oss-20b`/`openai/gpt-oss-120b`, live-verified against the real
 * API as of 2026-08-23.
 */
export const groqLlmProvider = createOpenAiCompatibleProvider({
  providerId: "groq_llm",
  displayName: "Groq",
  baseUrl: "https://api.groq.com/openai/v1/chat/completions",
  apiKeyEnvVar: "GROQ_API_KEY",
  cheapModelEnvVar: "GROQ_MODEL_CHEAP",
  capableModelEnvVar: "GROQ_MODEL_CAPABLE",
  defaultCheapModel: "openai/gpt-oss-20b",
  defaultCapableModel: "openai/gpt-oss-120b",
});
