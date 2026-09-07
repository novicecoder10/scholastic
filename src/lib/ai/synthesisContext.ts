import { embedQuery } from "@/lib/ai/embeddings";
import { getOrComputeEmbeddings } from "@/lib/ai/embeddings/cache";
import { cosineSimilarity } from "@/lib/ai/similarity";

const TOP_K = 8;

export interface SynthesisWork {
  workKey: string;
  title: string;
  abstract: string | null;
}

/**
 * Builds a retrieval-augmented context block for multi-paper synthesis chat:
 * embeds `query`, ranks the client-supplied `works` by cosine similarity to
 * it (reusing the exact same embedding-cache/similarity building blocks
 * `semanticRank.ts` uses for live semantic search), and formats the top ~8 as
 * titled context blocks. `works` is deliberately client-supplied (not looked
 * up server-side from the `work` table) — the client already has this data
 * in hand from the search response, and a new server-side DB dependency here
 * would have no defined graceful-degradation behavior the way the existing
 * embedding cache does.
 */
export async function buildSynthesisContext(
  query: string,
  works: SynthesisWork[],
): Promise<string> {
  if (works.length === 0) return "";

  const queryEmbedding = await embedQuery(query);
  const items = works.map((w) => ({
    workKey: w.workKey,
    text: `${w.title}\n${w.abstract ?? ""}`.trim(),
  }));
  const embeddingsByWorkKey = await getOrComputeEmbeddings(items);

  const ranked = works
    .map((w) => ({ work: w, embedding: embeddingsByWorkKey.get(w.workKey) }))
    .filter((w): w is { work: SynthesisWork; embedding: number[] } => w.embedding !== undefined)
    .map(({ work, embedding }) => ({
      work,
      similarity: cosineSimilarity(queryEmbedding, embedding),
    }))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, TOP_K);

  return ranked
    .map(
      ({ work }, i) =>
        `Paper ${i + 1}: ${work.title}\n${work.abstract ? `Abstract: ${work.abstract}` : "(no abstract available)"}`,
    )
    .join("\n\n");
}
