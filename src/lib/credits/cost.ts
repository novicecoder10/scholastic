/**
 * Token → credit conversion. Pure, no I/O, so every rate and rounding rule is
 * unit-tested rather than inferred from a running system.
 *
 * Credits are an internal allocation currency, not money and not a token count.
 * They are denominated so that the numbers a researcher sees are small enough to
 * reason about: an ordinary summary costs a credit or two, a long synthesis a
 * handful. The exchange rate lives here alone, so changing it never touches the
 * ledger, the pool, or any feature.
 */

/** Credits per 1,000 tokens, by task tier. */
const RATES: Record<string, { input: number; output: number }> = {
  // Bulk work runs on the cheap model: summaries, topic labels, query rewrites.
  bulk: { input: 0.5, output: 1.5 },
  // Reasoning work runs on the capable model and costs several times more.
  quality: { input: 2, output: 6 },
};

const DEFAULT_TIER = "bulk";

export function ratesForTier(tier: string): { input: number; output: number } {
  return RATES[tier] ?? RATES[DEFAULT_TIER];
}

/**
 * Output is always charged more than input, because it is what the provider
 * actually bills more for — a rule that survives any future rate change.
 *
 * Rounded **up**: a pool that systematically under-counts every small call
 * drains without anyone's balance moving. Work that consumed no tokens costs
 * nothing, so a refused or empty completion is free.
 */
export function creditsForUsage(tier: string, inputTokens: number, outputTokens: number): number {
  const input = Math.max(0, inputTokens);
  const output = Math.max(0, outputTokens);
  if (input + output === 0) return 0;

  const rate = ratesForTier(tier);
  const raw = (input * rate.input + output * rate.output) / 1000;
  return Math.max(1, Math.ceil(raw));
}

/**
 * What a feature is expected to cost, used by pre-flight before the real token
 * counts exist.
 *
 * Deliberately generous. An estimate that runs low lets someone start an
 * operation their balance cannot cover, and the debit lands after they have
 * already read the answer — the one case where credits go negative.
 */
const ESTIMATES: Record<string, number> = {
  summary: 2,
  query_understanding: 1,
  topic_labels: 3,
  citation_reasoning: 6,
  chat_turn: 4,
  document_chat_turn: 8,
  synthesis_turn: 10,
  paraphrase: 6,
  extraction: 12,
  table_interpretation: 2,
  findings: 5,
  matrix_cell: 3,
  grounded_draft: 14,
  deck_outline: 16,
  find_support: 3,
};

/** The fallback is the median metered feature, not zero: an unlisted feature
 * should cost something plausible rather than slip through unmetered. */
export const DEFAULT_ESTIMATE = 4;

export function estimateCredits(feature: string): number {
  return ESTIMATES[feature] ?? DEFAULT_ESTIMATE;
}

/** Every metered feature, for the "what things cost" table on /credits. */
export function costTable(): Array<{ feature: string; estimate: number }> {
  return Object.entries(ESTIMATES)
    .map(([feature, estimate]) => ({ feature, estimate }))
    .sort((a, b) => a.estimate - b.estimate || a.feature.localeCompare(b.feature));
}
