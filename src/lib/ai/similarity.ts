/**
 * Cosine similarity between two equal-length embedding vectors, in [-1, 1]
 * (in practice close to [0, 1] for normalized sentence embeddings of
 * same-domain text). Returns 0 for a zero-magnitude vector rather than
 * dividing by zero.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
