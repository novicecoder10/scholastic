export interface EmbeddingProvider {
  /** Stored alongside every cached vector so a model change is never silently
   * compared against a different model's vector space (see `cache.ts`). */
  modelId: string;
  isConfigured(): boolean;
  /** Returns one embedding per input text, in the same order as `texts`. */
  embed(texts: string[]): Promise<number[][]>;
}
