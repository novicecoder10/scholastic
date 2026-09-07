import { backoffDelay, sleep } from "@/lib/resilience/retry";
import { logger } from "@/lib/log/logger";
import type { EmbeddingProvider } from "@/lib/ai/embeddings/types";

const MODEL_NAME = "Xenova/all-MiniLM-L6-v2";
const MAX_LOAD_ATTEMPTS = 3;

// A minimal shape for the pipeline function/tensor we actually use, so this
// module doesn't need `@xenova/transformers`'s full (large, unstable-ish) type
// surface — imported lazily below since loading the package eagerly would pull
// in its runtime at module-import time even for requests that never embed.
type FeatureExtractionPipeline = (
  texts: string[],
  options: { pooling: "mean"; normalize: boolean },
) => Promise<{ tolist(): number[][] }>;

let pipelinePromise: Promise<FeatureExtractionPipeline> | null = null;

/**
 * Lazy-loaded and module-scope-cached: the model (~90MB) downloads once on
 * first use and is reused for the lifetime of the process afterward. A
 * transient network blip on that first download gets a small retry budget —
 * not the full circuit-breaker/health-tracking apparatus used for external
 * search providers, since after the first successful load there's no further
 * network dependency at all (unlike a provider hit on every search).
 */
async function loadPipeline(): Promise<FeatureExtractionPipeline> {
  if (!pipelinePromise) {
    pipelinePromise = (async () => {
      const { pipeline } = await import("@xenova/transformers");
      let lastError: unknown;
      for (let attempt = 0; attempt < MAX_LOAD_ATTEMPTS; attempt++) {
        try {
          logger.info(
            { event: "local_embedding_model_loading", model: MODEL_NAME, attempt },
            "loading local embedding model",
          );
          const extractor = (await pipeline(
            "feature-extraction",
            MODEL_NAME,
          )) as unknown as FeatureExtractionPipeline;
          logger.info(
            { event: "local_embedding_model_loaded", model: MODEL_NAME },
            "local embedding model ready",
          );
          return extractor;
        } catch (err) {
          lastError = err;
          if (attempt < MAX_LOAD_ATTEMPTS - 1) await sleep(backoffDelay(attempt));
        }
      }
      // Reset so a later call can retry from scratch rather than being stuck
      // replaying this same failed promise forever.
      pipelinePromise = null;
      throw lastError;
    })();
  }
  return pipelinePromise;
}

export const localEmbeddingProvider: EmbeddingProvider = {
  modelId: `local:${MODEL_NAME}`,

  isConfigured(): boolean {
    return true;
  },

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const extractor = await loadPipeline();
    const output = await extractor(texts, { pooling: "mean", normalize: true });
    return output.tolist();
  },
};
