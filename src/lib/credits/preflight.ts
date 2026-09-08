import { getBalance } from "@/lib/credits/ledger";
import { estimateCredits } from "@/lib/credits/cost";
import { anonymousAllowanceCredits } from "@/lib/credits/config";
import { anonymousAllowance } from "@/lib/db/schema";
import { getDb } from "@/lib/db/client";
import { isAuthEnabled } from "@/lib/auth/config";
import { logger } from "@/lib/log/logger";
import type { Owner } from "@/lib/auth/owner";
import { eq } from "drizzle-orm";

export interface PreflightResult {
  /** False only when the balance genuinely cannot cover the estimate. */
  allowed: boolean;
  /** What this operation is expected to cost. Shown before it runs. */
  estimate: number;
  balance: number | null;
  /** Set when `allowed` is false: a sentence, not a code. */
  message?: string;
  /** False when credits are not being enforced at all (accounts off, database
   * unreachable). Callers use it to decide whether to debit afterwards. */
  metered: boolean;
}

const UNMETERED = (estimate: number): PreflightResult => ({
  allowed: true,
  estimate,
  balance: null,
  metered: false,
});

/**
 * The one place credits can refuse a request, and it runs **before** anything
 * is spent.
 *
 * Fail open is a chosen trade-off rather than an oversight: if the database is
 * unreachable, AI features run unmetered and the failure is logged. A commons
 * that refuses service because its bookkeeping is offline is worse than one
 * that occasionally undercounts.
 */
export async function preflight(owner: Owner | null, feature: string): Promise<PreflightResult> {
  const estimate = estimateCredits(feature);

  // With accounts off there is no identity that can hold a balance and no
  // shared pool to protect — the instance is somebody's own, and unmetered.
  if (!isAuthEnabled()) return UNMETERED(estimate);
  if (!owner) return UNMETERED(estimate);

  try {
    if (owner.kind === "user") {
      const balance = await getBalance(owner.userId);
      if (balance >= estimate) return { allowed: true, estimate, balance, metered: true };
      return {
        allowed: false,
        estimate,
        balance,
        metered: true,
        message:
          `This needs about ${estimate} credits and you have ${balance}. ` +
          "Search, reading, citations and collections stay free — your balance tops up at the " +
          "start of each month, and verifying your ORCID iD grants credits for published work.",
      };
    }

    const allowance = anonymousAllowanceCredits();
    const used = await anonymousUsed(owner.sessionId);
    const remaining = Math.max(0, allowance - used);
    if (remaining >= estimate)
      return { allowed: true, estimate, balance: remaining, metered: true };
    return {
      allowed: false,
      estimate,
      balance: remaining,
      metered: true,
      message:
        `This needs about ${estimate} credits and this browser has ${remaining} left of its ` +
        `${allowance}-credit visitor allowance. Creating an account grants a full balance — ` +
        "search, reading and citations stay free either way.",
    };
  } catch (err) {
    logger.warn(
      { event: "credit_preflight_failed", feature, err: String(err) },
      "credit pre-flight failed — allowing the request unmetered",
    );
    return UNMETERED(estimate);
  }
}

async function anonymousUsed(sessionId: string): Promise<number> {
  const [row] = await getDb()
    .select()
    .from(anonymousAllowance)
    .where(eq(anonymousAllowance.sessionId, sessionId))
    .limit(1);
  if (!row) return 0;
  // The visitor allowance resets monthly, like every other period in #6.
  const now = new Date();
  const rolled =
    row.periodStartsAt.getUTCFullYear() !== now.getUTCFullYear() ||
    row.periodStartsAt.getUTCMonth() !== now.getUTCMonth();
  return rolled ? 0 : row.used;
}
