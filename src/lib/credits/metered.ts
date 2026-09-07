import { selectCapacity } from "@/lib/capacity/sources";
import { debit } from "@/lib/credits/spend";
import { preflight } from "@/lib/credits/preflight";
import { recordUsage } from "@/lib/ai/llm/usage";
import type { LlmProvider } from "@/lib/ai/llm/types";
import type { Owner } from "@/lib/auth/owner";
import { readOwner } from "@/lib/auth/owner";
import { logger } from "@/lib/log/logger";

/**
 * The single entry point every metered AI feature uses to get a provider.
 *
 * It does three things that used to be three separate concerns: picks the
 * capacity that will serve the request, checks the caller can afford it
 * *before* anything is spent, and hands back a usage callback that debits the
 * real token count afterwards.
 *
 * Reserve-then-reconcile, with the asymmetry deliberate: the pre-flight check
 * blocks, the debit does not. A dropped debit undercharges by one operation; a
 * debit that breaks a response the user already received is a bug they
 * experience.
 */

export class InsufficientCreditsError extends Error {
  readonly estimate: number;
  readonly balance: number | null;

  constructor(message: string, estimate: number, balance: number | null) {
    super(message);
    this.name = "InsufficientCreditsError";
    this.estimate = estimate;
    this.balance = balance;
  }
}

export interface MeteredLlm {
  provider: LlmProvider;
  /** Pass straight into `provider.complete({ onUsage })`. */
  onUsage: (usage: { inputTokens: number; outputTokens: number }) => void;
  /** What this was expected to cost, for a "this will use ~N credits" line. */
  estimate: number;
  /** Null when the request is not being metered at all. */
  balance: number | null;
  /** The sponsor whose capacity answered, once the call is done and only if
   * they asked to be named. Read it after `complete()`, never before: which
   * source served is not known until one does. */
  servedSponsor(): string | null;
}

/**
 * Returns null when no provider is configured — callers keep their existing
 * "not configured" 503 path unchanged. Throws `InsufficientCreditsError` only
 * when a balance genuinely cannot cover the work.
 */
export async function meteredLlm(
  feature: string,
  tier: string,
  owner?: Owner | null,
): Promise<MeteredLlm | null> {
  const resolved = owner === undefined ? await safeReadOwner() : owner;

  const check = await preflight(resolved, feature);
  if (!check.allowed) {
    throw new InsufficientCreditsError(
      check.message ?? "Not enough credits for this action.",
      check.estimate,
      check.balance,
    );
  }

  // Anonymous visitors draw from operator capacity only. Without this the
  // visitor allowance would spend donated quota, and "use it logged out" is the
  // hole that would make the whole system decorative.
  const selected = await selectCapacity(tier, {
    sponsorEligible: resolved?.kind === "user",
  });
  if (!selected) return null;

  const log = recordUsage(selected.provider, tier, feature);

  return {
    provider: selected.provider,
    estimate: check.estimate,
    balance: check.balance,
    servedSponsor: selected.servedSponsor,
    onUsage: (usage) => {
      log(usage);
      // Floating on purpose: the response is already on its way out, and
      // awaiting a bookkeeping write here would put the ledger on the critical
      // path of every AI answer.
      // `servedSourceId()` and not a captured id: the dispatcher may have
      // failed over, and the tokens belong to whichever key actually answered.
      void debit(
        check.metered ? resolved : null,
        feature,
        tier,
        usage,
        selected.servedSourceId(),
      ).catch((err) =>
        logger.warn({ event: "credit_debit_error", feature, err: String(err) }, "debit failed"),
      );
    },
  };
}

/** `readOwner()` reads cookies, which is unavailable outside a request scope
 * (a background job, a script). An unattributable call is unmetered rather
 * than refused — the same fail-open stance the rest of #6 takes. */
async function safeReadOwner(): Promise<Owner | null> {
  try {
    return await readOwner();
  } catch {
    return null;
  }
}
