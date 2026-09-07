import { embedQuery, getActiveEmbeddingProvider } from "@/lib/ai/embeddings";
import { cosineSimilarity } from "@/lib/ai/similarity";
import { logger } from "@/lib/log/logger";
import { ensureIndexed } from "@/lib/documents/ingest";
import { listChunks, type StoredChunk } from "@/lib/documents/repository";

export const DEFAULT_TOP_K = 8;

export interface RetrievedChunk {
  chunkIndex: number;
  pageStart: number;
  pageEnd: number;
  content: string;
  score: number;
  /** True when embeddings were unavailable and term overlap was used instead. */
  lexical: boolean;
}

const STOP_WORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "but",
  "of",
  "to",
  "in",
  "on",
  "for",
  "with",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "it",
  "this",
  "that",
  "as",
  "by",
  "at",
  "from",
  "what",
  "how",
  "why",
  "does",
  "do",
  "did",
  "which",
  "who",
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2 && !STOP_WORDS.has(t));
}

/**
 * Term-overlap scoring, used when embeddings are unavailable or a document
 * isn't indexed yet. Deliberately simple: it is a floor that keeps the feature
 * usable, not a competitor to the vector path. Rarer query terms count for
 * more, and longer chunks are normalized so they don't win on length alone.
 */
export function lexicalScore(queryTokens: string[], chunk: string): number {
  if (queryTokens.length === 0) return 0;
  const chunkTokens = tokenize(chunk);
  if (chunkTokens.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const token of chunkTokens) counts.set(token, (counts.get(token) ?? 0) + 1);

  let score = 0;
  for (const token of new Set(queryTokens)) {
    const hits = counts.get(token) ?? 0;
    if (hits > 0) score += 1 + Math.log(hits);
  }
  return score / Math.sqrt(chunkTokens.length);
}

function rankLexically(query: string, chunks: StoredChunk[], topK: number): RetrievedChunk[] {
  const queryTokens = tokenize(query);
  return chunks
    .map((c) => ({
      chunkIndex: c.chunkIndex,
      pageStart: c.pageStart,
      pageEnd: c.pageEnd,
      content: c.content,
      score: lexicalScore(queryTokens, c.content),
      lexical: true,
    }))
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

/**
 * The single contract #3 (chat with PDF) and #7 (extract data) depend on.
 *
 * Deliberately an internal function rather than an HTTP endpoint: exposing raw
 * retrieval would let anyone holding a document id page through the entire
 * paper a chunk at a time, which is a redistribution surface for copyrighted
 * PDFs that the product has no reason to offer.
 *
 * Degrades in the app's usual direction — if embeddings are missing or the
 * provider fails, it falls back to term overlap rather than returning nothing.
 */
export async function retrieveChunks(
  documentId: string,
  query: string,
  topK: number = DEFAULT_TOP_K,
): Promise<RetrievedChunk[]> {
  const chunks = await listChunks(documentId);
  if (chunks.length === 0) return [];

  const modelId = getActiveEmbeddingProvider().modelId;
  const embedded = chunks.filter((c) => c.embedding !== null);

  if (embedded.length < chunks.length) {
    // Self-healing: a document whose phase 2 never ran, or ran under a
    // different model, gets indexed on first use. Un-awaited so the current
    // request answers from what is already available.
    void ensureIndexed(documentId).catch(() => {});
  }

  if (embedded.length === 0) return rankLexically(query, chunks, topK);

  try {
    const queryEmbedding = await embedQuery(query);
    return embedded
      .map((c) => ({
        chunkIndex: c.chunkIndex,
        pageStart: c.pageStart,
        pageEnd: c.pageEnd,
        content: c.content,
        score: cosineSimilarity(queryEmbedding, c.embedding as number[]),
        lexical: false,
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  } catch (err) {
    logger.warn(
      { event: "document_retrieval_embedding_failed", documentId, modelId, err: String(err) },
      "query embedding failed; falling back to lexical retrieval",
    );
    return rankLexically(query, chunks, topK);
  }
}
