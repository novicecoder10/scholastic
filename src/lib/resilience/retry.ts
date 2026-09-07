export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Exponential backoff with full jitter, capped at 3s per attempt.
 * attempt is 0-indexed (0 = delay before the first retry).
 */
export function backoffDelay(attempt: number): number {
  const base = 300 * 2 ** attempt;
  const capped = Math.min(base, 3000);
  return Math.random() * capped;
}
