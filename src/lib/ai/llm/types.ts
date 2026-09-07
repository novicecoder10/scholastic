export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface CompleteParams {
  /** Passed per call, not hardcoded in the provider — use `provider.models.cheap`/`.capable`
   * from the active provider rather than a literal string, since backends don't share model ids. */
  model: string;
  system?: string;
  messages: ChatMessage[];
  maxTokens?: number;
  /** Optional callback for recording token usage after a successful call. */
  onUsage?: (usage: { inputTokens: number; outputTokens: number }) => void;
}

export interface LlmProvider {
  /** Each backend declares its own appropriate model ids per task tier — a bulk/low-complexity
   * job (summaries, query understanding) uses `cheap`; a job needing to reason across more
   * context (chat, synthesis, citation reasoning) uses `capable`. */
  models: { cheap: string; capable: string };
  isConfigured(): boolean;
  complete(params: CompleteParams): Promise<string>;
  streamComplete(params: CompleteParams): AsyncGenerator<string>;
}
