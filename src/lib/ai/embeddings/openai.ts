import { EMBEDDING_DIMENSIONS } from "@/lib/db/schema";
import { withResilience } from "@/lib/resilience/withResilience";
import type { EmbeddingProvider } from "@/lib/ai/embeddings/types";

const BASE_URL = "https://api.openai.com/v1/embeddings";
const MODEL = "text-embedding-3-small";

interface OpenAiEmbeddingResponse {
  data: { embedding: number[]; index: number }[];
}

export const openaiEmbeddingProvider: EmbeddingProvider = {
  modelId: `openai:${MODEL}:${EMBEDDING_DIMENSIONS}`,

  isConfigured(): boolean {
    return Boolean(process.env.OPENAI_API_KEY);
  },

  async embed(texts: string[]): Promise<number[][]> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("openaiEmbeddingProvider.embed called without OPENAI_API_KEY configured");
    }
    if (texts.length === 0) return [];

    return withResilience("embeddings_openai", async (ctx) => {
      const response = await fetch(BASE_URL, {
        method: "POST",
        signal: ctx.signal,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: MODEL,
          input: texts,
          dimensions: EMBEDDING_DIMENSIONS,
        }),
      });

      if (!response.ok) {
        throw new Error(`OpenAI embeddings request failed with status ${response.status}`);
      }

      const data = (await response.json()) as OpenAiEmbeddingResponse;
      return data.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
    });
  },
};
