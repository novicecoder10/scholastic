/**
 * Every credit figure that an operator can change, in one place and published
 * on `/credits`. A commons whose allocation rules are only discoverable by
 * running out is not a commons anyone can plan around.
 */

function positiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/** Sized so a new researcher can complete a genuine literature review on day
 * one, not so they can sample the feature and stop. */
export function welcomeGrant(): number {
  return positiveInt("CREDITS_WELCOME_GRANT", 500);
}

/** A monthly top-up **to** this figure, never an addition to it: credits
 * accrued by inactivity would let a dormant account hold a claim on capacity
 * that active researchers need. */
export function monthlyFloor(): number {
  return positiveInt("CREDITS_MONTHLY_FLOOR", 300);
}

/** Anonymous visitors hold no balance. They get a flat per-session allowance,
 * drawn only from operator capacity — sponsors donate to researchers, not to an
 * unauthenticated firehose. */
export function anonymousAllowanceCredits(): number {
  return positiveInt("CREDITS_ANON_SESSION_ALLOWANCE", 40);
}

/** Per verified publication, before diminishing returns. */
export function publicationGrant(): number {
  return positiveInt("CREDITS_PER_PUBLICATION", 25);
}

/** Per verified peer review. Reviewing is unpaid, invisible work that the
 * literature depends on, and it is rewarded at the same rate as authorship. */
export function peerReviewGrant(): number {
  return positiveInt("CREDITS_PER_PEER_REVIEW", 25);
}

/** Publications past this count in one grant run earn at a reduced rate. */
export function diminishingThreshold(): number {
  return positiveInt("CREDITS_DIMINISHING_THRESHOLD", 10);
}
