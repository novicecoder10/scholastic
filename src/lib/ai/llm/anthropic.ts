import Anthropic from "@anthropic-ai/sdk";
import { withResilience } from "@/lib/resilience/withResilience";
import type { CompleteParams, LlmProvider } from "@/lib/ai/llm/types";

const DEFAULT_MAX_TOKENS = 1024;
const STREAM_TIMEOUT_MS = 30_000;
// LLM text generation legitimately takes longer than the 6s default tuned for
// metadata-fetch API calls (search providers, citation lookups) — observed
// live against the free-tier OpenRouter backend, where a real completion
// (not a trivial test prompt) took long enough to exceed that default and
// fail the whole call after retries, even though the backend was healthy and
// eventually would have responded.
const COMPLETE_TIMEOUT_MS = 30_000;

function getClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("anthropicLlmProvider called without ANTHROPIC_API_KEY configured");
  }
  return new Anthropic({ apiKey });
}

/**
 * No local fallback here (unlike embeddings) — a quality-competitive LLM
 * can't run meaningfully on this hardware. Absent ANTHROPIC_API_KEY, summaries
 * and chat are simply disabled (see the /api/works/[workKey]/summary and
 * /api/chat routes), the same graceful-degradation contract as CORE/
 * Unpaywall/PubMed without their own credentials.
 */
export const anthropicLlmProvider: LlmProvider = {
  models: { cheap: "claude-haiku-4-5-20251001", capable: "claude-sonnet-5" },

  isConfigured(): boolean {
    return Boolean(process.env.ANTHROPIC_API_KEY);
  },

  /** Non-streaming, single-shot call — used for summaries. Goes through the
   * standard withResilience wrapper (retry/timeout/circuit-breaker) exactly
   * like every external provider call in this codebase. */
  async complete({
    model,
    system,
    messages,
    maxTokens = DEFAULT_MAX_TOKENS,
    onUsage,
  }: CompleteParams): Promise<string> {
    const client = getClient();
    const message = await withResilience(
      "anthropic_llm",
      (ctx) =>
        client.messages.create(
          {
            model,
            max_tokens: maxTokens,
            system,
            messages,
          },
          { signal: ctx.signal },
        ),
      { timeoutMs: COMPLETE_TIMEOUT_MS },
    );

    if (onUsage && message.usage) {
      onUsage({
        inputTokens: message.usage.input_tokens,
        outputTokens: message.usage.output_tokens,
      });
    }

    const textBlock = message.content.find((block) => block.type === "text");
    return textBlock && textBlock.type === "text" ? textBlock.text : "";
  },

  /**
   * Streaming — used for chat. Intentionally bypasses withResilience's
   * retry/cache machinery: retrying mid-stream would silently restart a
   * partially-delivered response, which is worse UX than surfacing the
   * failure once and letting the caller decide. A plain timeout still applies
   * so a hung connection doesn't block forever; it's longer than search's 6s
   * default since LLM generation legitimately takes longer.
   */
  async *streamComplete({
    model,
    system,
    messages,
    maxTokens = DEFAULT_MAX_TOKENS,
    onUsage,
  }: CompleteParams): AsyncGenerator<string> {
    const client = getClient();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), STREAM_TIMEOUT_MS);

    try {
      const stream = client.messages.stream(
        { model, max_tokens: maxTokens, system, messages },
        { signal: controller.signal },
      );
      // Anthropic splits the counts across two events: the input tokens are
      // known when the message starts, the output tokens only at the end.
      let inputTokens = 0;
      for await (const event of stream) {
        if (event.type === "message_start") {
          inputTokens = event.message.usage?.input_tokens ?? 0;
        }
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          yield event.delta.text;
        }
        if (event.type === "message_delta" && onUsage) {
          onUsage({ inputTokens, outputTokens: event.usage?.output_tokens ?? 0 });
        }
      }
    } finally {
      clearTimeout(timer);
    }
  },
};
