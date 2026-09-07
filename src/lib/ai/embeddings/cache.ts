import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { workEmbedding } from "@/lib/db/schema";
import { getActiveEmbeddingProvider } from "@/lib/ai/embeddings";
import type { EmbeddingProvider } from "@/lib/ai/embeddings/types";
import { logger } from "@/lib/log/logger";

export interface EmbeddableWork {
  workKey: string;
  /** Text to embed — typically title + abstract. */
  text: string;
}

/**
 * Gets-or-computes an embedding per work, keyed by (workKey, the currently
 * active embedding model's id) — NOT workKey alone. A cache hit under a
 * different model than the one active right now must be treated as a miss and
 * recomputed: the same dimensionality from two different models is not a
 * comparable vector space, and silently mixing them would corrupt ranking
 * with no visible error. This is a cross-query compute cache, not a
 * pre-built searchable index — see ARCHITECTURE.md.
 *
 * A missing/unreachable database degrades to "no cache" (every item is
 * computed fresh via the provider), never a hard failure — same contract as
 * every other DB-backed cache in this app (e.g. search_cache).
 */
export async function getOrComputeEmbeddings(
  items: EmbeddableWork[],
  provider: EmbeddingProvider = getActiveEmbeddingProvider(),
): Promise<Map<string, number[]>> {
  const result = new Map<string, number[]>();
  if (items.length === 0) return result;

  const workKeys = items.map((i) => i.workKey);

  let db: ReturnType<typeof getDb> | null = null;
  try {
    db = getDb();
  } catch (err) {
    logger.warn(
      { event: "embedding_cache_unavailable", err: String(err) },
      "embedding cache DB unavailable, computing without cache",
    );
  }

  if (db) {
    try {
      const cachedRows = await db
        .select({ workKey: workEmbedding.workKey, embedding: workEmbedding.embedding })
        .from(workEmbedding)
        .where(
          and(
            inArray(workEmbedding.workKey, workKeys),
            eq(workEmbedding.embeddingModelId, provider.modelId),
          ),
        );
      for (const row of cachedRows) result.set(row.workKey, row.embedding);
    } catch (err) {
      logger.warn(
        { event: "embedding_cache_read_failed", err: String(err) },
        "embedding cache DB read failed",
      );
    }
  }

  const misses = items.filter((i) => !result.has(i.workKey));
  if (misses.length === 0) return result;

  const computed = await provider.embed(misses.map((m) => m.text));
  misses.forEach((miss, i) => result.set(miss.workKey, computed[i]));

  if (db) {
    try {
      await db
        .insert(workEmbedding)
        .values(
          misses.map((miss, i) => ({
            workKey: miss.workKey,
            embeddingModelId: provider.modelId,
            embedding: computed[i],
          })),
        )
        .onConflictDoNothing();
    } catch (err) {
      // A cache-write failure must never affect the ranking that triggered it
      // — the computed embeddings above are already returned to the caller.
      logger.warn(
        { event: "embedding_cache_write_failed", err: String(err) },
        "embedding cache DB write failed",
      );
    }
  }

  return result;
}
