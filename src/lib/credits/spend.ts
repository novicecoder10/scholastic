import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { anonymousAllowance } from "@/lib/db/schema";
import { creditsForUsage } from "@/lib/credits/cost";
import { post } from "@/lib/credits/ledger";
import { recordCapacityUsage } from "@/lib/capacity/sources";
import { describeDbError } from "@/lib/db/describeError";
import { logger } from "@/lib/log/logger";
import type { Owner } from "@/lib/auth/owner";

/**
 * The debit half of the reserve-then-reconcile pair.
 *
 * Deliberately non-blocking and error-swallowing, matching `recordUsage`'s
 * existing contract: this runs after the response the user already has. A
 * dropped debit undercharges by one operation; a debit that breaks a delivered
 * response is a bug they experience. Pre-flight bounds how much undercharging
 * can accumulate.
 */
export async function debit(
  owner: Owner | null,
  feature: string,
  tier: string,
  usage: { inputTokens: number; outputTokens: number },
  sourceId: string | null,
): Promise<void> {
  const credits = creditsForUsage(tier, usage.inputTokens, usage.outputTokens);
  const tokens = Math.max(0, usage.inputTokens) + Math.max(0, usage.outputTokens);

  try {
    if (sourceId) await recordCapacityUsage(sourceId, tokens);
  } catch (err) {
    logger.warn(
      { event: "capacity_usage_record_failed", sourceId, err: describeDbError(err) },
      "capacity usage not recorded",
    );
  }

  if (!owner || credits <= 0) return;

  try {
    if (owner.kind === "user") {
      await post(owner.userId, -credits, "spend", {
        detail: { feature, tier, ...usage },
      });
      return;
    }
    await getDb()
      .insert(anonymousAllowance)
      .values({ sessionId: owner.sessionId, used: credits })
      .onConflictDoUpdate({
        target: anonymousAllowance.sessionId,
        set: {
          // Rolls the period over in the same statement, so a visitor whose
          // last call was last month starts from this call rather than from a
          // stale total.
          used: sql`case when date_trunc('month', ${anonymousAllowance.periodStartsAt})
              < date_trunc('month', now())
            then ${credits} else ${anonymousAllowance.used} + ${credits} end`,
          periodStartsAt: sql`case when date_trunc('month', ${anonymousAllowance.periodStartsAt})
              < date_trunc('month', now())
            then now() else ${anonymousAllowance.periodStartsAt} end`,
        },
      });
  } catch (err) {
    logger.warn(
      { event: "credit_debit_failed", feature, credits, err: describeDbError(err) },
      "credit debit dropped",
    );
  }
}
