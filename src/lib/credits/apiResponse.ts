import { NextResponse } from "next/server";
import { InsufficientCreditsError } from "@/lib/credits/metered";

/**
 * **403, not 402.** Payment Required would be the obvious status and it is the
 * wrong one: nothing here is purchasable, and a status that tells a client
 * "pay to continue" would misdescribe the whole system. The request is
 * well-formed and the caller is authenticated — they simply may not do this
 * right now.
 *
 * `reason` is machine-readable so a client can tell an empty balance apart from
 * every other 403 without parsing prose.
 */
export function insufficientCreditsResponse(err: InsufficientCreditsError): NextResponse {
  return NextResponse.json(
    {
      error: err.message,
      reason: "insufficient_credits",
      estimate: err.estimate,
      balance: err.balance,
    },
    { status: 403 },
  );
}

export function isInsufficientCredits(err: unknown): err is InsufficientCreditsError {
  return err instanceof InsufficientCreditsError;
}
