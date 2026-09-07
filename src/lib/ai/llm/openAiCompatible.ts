import { logger } from "@/lib/log/logger";
import { withResilience } from "@/lib/resilience/withResilience";
import type { ChatMessage, CompleteParams, LlmProvider } from "@/lib/ai/llm/types";

const DEFAULT_MAX_TOKENS = 1024;
const STREAM_TIMEOUT_MS = 30_000;
// LLM text generation legitimately takes longer than the 6s default tuned for
// metadata-fetch API calls — observed live: a real completion (not a trivial
// test prompt) on a free tier took long enough to exceed that default and
// fail after retries, even though the backend was healthy and would
// eventually have responded.
const COMPLETE_TIMEOUT_MS = 30_000;

function toMessages(system: string | undefined, messages: ChatMessage[]) {
  return system ? [{ role: "system", content: system }, ...messages] : messages;
}

interface CompletionResponse {
  choices?: { message?: { content?: string | null }; finish_reason?: string | null }[];
}

export interface OpenAiCompatibleConfig {
  /** Unique id for withResilience's circuit-breaker/health tracking + error messages. */
  providerId: string;
  /** Human-readable name, currently unused by this factory but carried
   * through by every concrete config for future display in health/usage UI. */
  displayName: string;
  baseUrl: string;
  /** The NAME of the env var holding the key — never the key. Null for an
   * endpoint that takes no credential, such as a cluster node reachable only
   * on a private network; the Authorization header is then omitted entirely
   * rather than sent as `Bearer undefined`. */
  apiKeyEnvVar: string | null;
  /** Omitted by endpoint-backed sources, which serve exactly one model and
   * have no env var of their own to override it with. */
  cheapModelEnvVar?: string;
  capableModelEnvVar?: string;
  defaultCheapModel: string;
  defaultCapableModel: string;
}

/**
 * Factory for LLM backends whose API is OpenAI-chat-completions-compatible —
 * OpenRouter, Groq, and Google's Gemini (via its OpenAI-compatibility
 * endpoint) all are. The request/response/SSE-streaming shape is identical
 * across all three; only the base URL, API key env var, and model ids
 * differ, so each concrete provider (`openrouter.ts`, `groq.ts`, `gemini.ts`)
 * is just a config wrapper around this shared implementation.
 */
export function createOpenAiCompatibleProvider(config: OpenAiCompatibleConfig): LlmProvider {
  function getApiKey(): string | null {
    if (config.apiKeyEnvVar === null) return null;
    const apiKey = process.env[config.apiKeyEnvVar];
    if (!apiKey) {
      throw new Error(`${config.providerId} called without ${config.apiKeyEnvVar} configured`);
    }
    return apiKey;
  }

  function headers(apiKey: string | null): Record<string, string> {
    return apiKey
      ? { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }
      : { "Content-Type": "application/json" };
  }

  function modelFor(envVar: string | undefined, fallback: string): string {
    return (envVar ? process.env[envVar] : undefined) || fallback;
  }

  return {
    models: {
      cheap: modelFor(config.cheapModelEnvVar, config.defaultCheapModel),
      capable: modelFor(config.capableModelEnvVar, config.defaultCapableModel),
    },

    isConfigured(): boolean {
      return config.apiKeyEnvVar === null ? true : Boolean(process.env[config.apiKeyEnvVar]);
    },

    async complete({
      model,
      system,
      messages,
      maxTokens = DEFAULT_MAX_TOKENS,
      onUsage,
    }: CompleteParams): Promise<string> {
      const apiKey = getApiKey();
      const result = await withResilience(
        config.providerId,
        async (ctx) => {
          const response = await fetch(config.baseUrl, {
            method: "POST",
            signal: ctx.signal,
            headers: headers(apiKey),
            body: JSON.stringify({
              model,
              max_tokens: maxTokens,
              messages: toMessages(system, messages),
            }),
          });
          if (!response.ok) {
            throw new Error(`${config.providerId} request failed with status ${response.status}`);
          }
          const data = (await response.json()) as CompletionResponse & {
            usage?: { prompt_tokens?: number; completion_tokens?: number };
          };
          if (onUsage && data.usage) {
            onUsage({
              inputTokens: data.usage.prompt_tokens ?? 0,
              outputTokens: data.usage.completion_tokens ?? 0,
            });
          }
          const content = data.choices?.[0]?.message?.content ?? "";
          if (content.trim() === "") {
            // A successful HTTP call that produced no text. On a reasoning
            // model — several backends default to one — the reasoning trace is
            // charged against max_tokens before any content is emitted, so a
            // tight budget silently yields "". Callers then see a parse failure
            // with no clue why, so name the condition here once rather than in
            // each of them. (Observed live against Groq's openai/gpt-oss-20b.)
            logger.warn(
              {
                event: "llm_empty_completion",
                providerId: config.providerId,
                model,
                maxTokens,
                finishReason: data.choices?.[0]?.finish_reason ?? null,
              },
              "LLM returned an empty completion; consider a larger maxTokens",
            );
          }
          return content;
        },
        { timeoutMs: COMPLETE_TIMEOUT_MS },
      );
      return result;
    },

    /**
     * Hand-parsed SSE (no SDK doing this for us): OpenAI-style
     * `data: {...}\n\n` frames, terminated by a literal `data: [DONE]` line.
     * Buffers across chunk boundaries since a single `read()` can split a
     * frame mid-line. Bypasses `withResilience` for the same reason as the
     * Anthropic adapter's streaming path — retrying mid-stream would restart
     * an already-partially-delivered response.
     */
    async *streamComplete({
      model,
      system,
      messages,
      maxTokens = DEFAULT_MAX_TOKENS,
      onUsage,
    }: CompleteParams): AsyncGenerator<string> {
      const apiKey = getApiKey();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), STREAM_TIMEOUT_MS);

      try {
        const response = await fetch(config.baseUrl, {
          method: "POST",
          signal: controller.signal,
          headers: headers(apiKey),
          body: JSON.stringify({
            model,
            max_tokens: maxTokens,
            stream: true,
            // Asks the backend for a final usage frame. Without it a streamed
            // answer reports no token counts at all, and chat — the most
            // expensive feature in the app — would never be metered. Backends
            // that don't implement it ignore the field and simply send no
            // usage, which costs nothing here.
            stream_options: { include_usage: true },
            messages: toMessages(system, messages),
          }),
        });
        if (!response.ok || !response.body) {
          throw new Error(
            `${config.providerId} stream request failed with status ${response.status}`,
          );
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data:")) continue;
            const payload = trimmed.slice("data:".length).trim();
            if (payload === "[DONE]") return;
            if (!payload) continue;

            try {
              const parsed = JSON.parse(payload) as {
                choices?: { delta?: { content?: string } }[];
                usage?: { prompt_tokens?: number; completion_tokens?: number };
              };
              // The usage frame arrives last and carries no choices.
              if (onUsage && parsed.usage) {
                onUsage({
                  inputTokens: parsed.usage.prompt_tokens ?? 0,
                  outputTokens: parsed.usage.completion_tokens ?? 0,
                });
              }
              const delta = parsed.choices?.[0]?.delta?.content;
              if (delta) yield delta;
            } catch {
              // Malformed/partial line (e.g. a keep-alive comment) — ignore
              // rather than aborting an otherwise-healthy stream over one frame.
            }
          }
        }
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
