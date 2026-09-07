import type { LlmProvider } from "@/lib/ai/llm/types";
import { logger } from "@/lib/log/logger";

/**
 * Records LLM usage metrics. Returns an `onUsage` callback suitable for
 * passing into `provider.complete()`.
 *
 * This is a lightweight telemetry hook — it logs usage data and is
 * intentionally non-blocking. A failure here must never affect the
 * response.
 */
export function recordUsage(
  provider: LlmProvider,
  tier: string,
  feature: string,
): (usage: { inputTokens: number; outputTokens: number }) => void {
  return (usage) => {
    try {
      logger.info(
        {
          event: "llm_usage",
          provider: provider.models.cheap.split("/").pop() ?? "unknown",
          tier,
          feature,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
        },
        "LLM usage recorded",
      );
    } catch {
      // Swallow — telemetry must never affect the response.
    }
  };
}
