import {
  diminishingThreshold,
  monthlyFloor,
  peerReviewGrant,
  publicationGrant,
  welcomeGrant,
} from "@/lib/credits/config";
import { getBalance, hasGrant, post } from "@/lib/credits/ledger";
import { logger } from "@/lib/log/logger";

/**
 * Where credits come from. Never from in-app activity: farming a commons is
 * farming other researchers.
 */

export function currentPeriodKey(now = new Date()): string {
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${now.getUTCFullYear()}-${month}`;
}

/** Once per account, ever. The idempotency key carries no date for exactly
 * that reason. */
export async function grantWelcome(userId: string): Promise<number> {
  const amount = welcomeGrant();
  return post(userId, amount, "welcome_grant", {
    idempotencyKey: "welcome",
    detail: { amount },
  });
}

/**
 * Tops a balance **up to** the floor rather than adding to it, so a month of
 * not using the tool grants nothing and an active researcher is not overtaken
 * by a dormant account.
 *
 * A balance already above the floor is left alone, and no ledger row is written
 * — an entry reading "+0" is noise in a history whose whole purpose is being
 * readable.
 */
export async function grantMonthlyReplenishment(userId: string, now = new Date()): Promise<number> {
  const floor = monthlyFloor();
  const key = `replenish:${currentPeriodKey(now)}`;
  if (await hasGrant(userId, key)) return getBalance(userId);

  const balance = await getBalance(userId);
  if (balance >= floor) return balance;

  return post(userId, floor - balance, "periodic_replenishment", {
    idempotencyKey: key,
    detail: { floor, previousBalance: balance },
  });
}

export interface Contribution {
  /** Stable external id: an OpenAlex work id, or an ORCID review put-code. */
  id: string;
  kind: "publication" | "peer_review";
  title: string;
  year?: number | null;
}

export interface GrantRunResult {
  granted: number;
  credits: number;
  alreadyCounted: number;
  balance: number;
}

/**
 * Diminishing returns past a threshold, halving each further step.
 *
 * A fairness decision, written as a curve rather than hidden in a constant: a
 * prolific senior author should not accumulate a large claim on a shared pool
 * they cannot spend while an early-career researcher runs dry. The floor of 1
 * means a contribution is always worth something.
 */
export function publicationCredit(indexPastThreshold: number, base: number): number {
  if (indexPastThreshold <= 0) return base;
  return Math.max(1, Math.round(base / 2 ** Math.min(indexPastThreshold, 6)));
}

/**
 * Awards credits for verified contributions, skipping anything already counted.
 *
 * Idempotency is per external id, so re-running after publishing one new paper
 * grants for that paper alone. The run is on demand — the user asks — rather
 * than on a schedule, because a background job that silently changes someone's
 * balance is harder to explain than a button they pressed.
 */
export async function grantForContributions(
  userId: string,
  contributions: Contribution[],
): Promise<GrantRunResult> {
  const threshold = diminishingThreshold();
  let granted = 0;
  let credits = 0;
  let alreadyCounted = 0;
  let balance = await getBalance(userId);
  let publicationIndex = 0;

  for (const contribution of contributions) {
    const key =
      contribution.kind === "publication" ? `work:${contribution.id}` : `review:${contribution.id}`;

    if (await hasGrant(userId, key)) {
      alreadyCounted += 1;
      if (contribution.kind === "publication") publicationIndex += 1;
      continue;
    }

    const amount =
      contribution.kind === "publication"
        ? publicationCredit(publicationIndex - threshold + 1, publicationGrant())
        : peerReviewGrant();

    if (contribution.kind === "publication") publicationIndex += 1;

    try {
      balance = await post(
        userId,
        amount,
        contribution.kind === "publication" ? "publication_verified" : "peer_review_verified",
        {
          idempotencyKey: key,
          detail: { title: contribution.title, year: contribution.year ?? null, amount },
        },
      );
      granted += 1;
      credits += amount;
    } catch (err) {
      logger.warn(
        { event: "credit_contribution_grant_failed", key, err: String(err) },
        "contribution grant failed",
      );
    }
  }

  return { granted, credits, alreadyCounted, balance };
}
