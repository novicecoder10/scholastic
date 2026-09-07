import { openaiEmbeddingProvider } from "@/lib/ai/embeddings/openai";
import { localEmbeddingProvider } from "@/lib/ai/embeddings/local";
import type { EmbeddingProvider } from "@/lib/ai/embeddings/types";

/** Single selection point: hosted embeddings when configured, local fallback otherwise. */
export function getActiveEmbeddingProvider(): EmbeddingProvider {
  return openaiEmbeddingProvider.isConfigured() ? openaiEmbeddingProvider : localEmbeddingProvider;
}

/** A query embedding is ad hoc (never cached — queries are rarely repeated verbatim). */
export async function embedQuery(query: string): Promise<number[]> {
  const [embedding] = await getActiveEmbeddingProvider().embed([query]);
  return embedding;
}

export type { EmbeddingProvider } from "@/lib/ai/embeddings/types";
export { openaiEmbeddingProvider } from "@/lib/ai/embeddings/openai";
export { localEmbeddingProvider } from "@/lib/ai/embeddings/local";
