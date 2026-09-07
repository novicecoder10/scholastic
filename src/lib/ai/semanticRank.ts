import { embedQuery } from "@/lib/ai/embeddings";
import { getOrComputeEmbeddings } from "@/lib/ai/embeddings/cache";
import { cosineSimilarity } from "@/lib/ai/similarity";
import { rankWorksBySimilarity } from "@/lib/merge/rank";
import type { CanonicalWork } from "@/lib/types/work";

/**
 * Ranks an already-merged candidate pool by semantic similarity to the query
 * instead of keyword-token overlap. This does NOT pre-build a from-scratch
 * index over all of scholarship (infeasible — OpenAlex alone is 250M+ works);
 * candidates are exactly the same live multi-provider fan-out + dedup result
 * as keyword mode, so semantic mode still depends on provider-side keyword
 * retrieval to produce a good candidate pool — only the ranking signal
 * differs. See ARCHITECTURE.md and KNOWN_LIMITATIONS.md.
 */
export async function rankBySemanticSimilarity(
  works: CanonicalWork[],
  query: string,
): Promise<CanonicalWork[]> {
  if (works.length === 0) return [];

  const queryEmbedding = await embedQuery(query);

  const items = works.map((w) => ({
    workKey: w.workKey,
    text: `${w.title}\n${w.abstract ?? ""}`.trim(),
  }));
  const embeddingsByWorkKey = await getOrComputeEmbeddings(items);

  const similarityByWorkId = new Map<string, number>();
  works.forEach((w) => {
    const embedding = embeddingsByWorkKey.get(w.workKey);
    if (embedding) similarityByWorkId.set(w.id, cosineSimilarity(queryEmbedding, embedding));
  });

  return rankWorksBySimilarity(works, similarityByWorkId);
}
