import type { NextRequest } from "next/server";
import { claimAnonymousSession } from "@/lib/auth/owner";
import {
  newSessionId,
  readSessionId,
  SESSION_COOKIE,
  signSessionId,
} from "@/lib/documents/session";
import { grantMonthlyReplenishment, grantWelcome } from "@/lib/credits/grants";
import { isAuthEnabled } from "@/lib/auth/config";
import { logger } from "@/lib/log/logger";

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

function isSignIn(pathname: string): boolean {
  return /\/(sign-in|sign-up|callback)(\/|$)/.test(pathname);
}

function isSignOut(pathname: string): boolean {
  return /\/sign-out(\/|$)/.test(pathname);
}

/**
 * The two moments where #2's browser identity and better-auth's user identity
 * have to be reconciled. Everything else leaves both cookies alone.
 *
 * **Sign-in / sign-up** adopts this browser's un-owned uploads into the account,
 * so a visitor who uploaded three papers before creating an account keeps them.
 *
 * **Sign-out rotates `scholastic_sid`.** Without that, the next anonymous
 * visitor on a shared browser resumes the departing user's device identity —
 * and while `ownedBy()` already refuses to hand them rows that carry a userId,
 * they would inherit any *later* anonymous uploads made under that same id.
 * Rotating is the cheap, obviously-correct answer.
 *
 * Sign-in is also where #6's credit grants run. Both are idempotent — the
 * welcome grant once per account ever, the replenishment once per calendar
 * month — so "the user showed up" is a safe trigger and needs no scheduler. A
 * background job that silently changed someone's balance would be harder to
 * explain than a top-up they can see happened when they signed in.
 */
export async function afterAuthResponse(
  request: NextRequest,
  response: Response,
): Promise<Response> {
  const { pathname } = request.nextUrl;

  if (response.ok && isSignIn(pathname)) {
    // The new session cookie is on the RESPONSE at this point, not the request,
    // so asking better-auth for "the current session" here would still see the
    // signed-out state. The user id is read out of the response body instead,
    // via a clone so the original stream still reaches the client untouched.
    const [forReading, forClient] = [response.clone(), response];
    let userId: string | null = null;
    try {
      const body = (await forReading.json()) as { user?: { id?: unknown } };
      if (typeof body?.user?.id === "string") userId = body.user.id;
    } catch (err) {
      logger.warn(
        { event: "adoption_skipped", err: String(err) },
        "could not read the signed-in user from the auth response; uploads not adopted",
      );
    }
    if (!userId) return forClient;

    const sessionId = await readSessionId();
    if (sessionId) {
      try {
        await claimAnonymousSession(userId, sessionId);
      } catch (err) {
        // A sign-in must never fail because adoption did. The documents stay
        // reachable by session, which is the state they were already in.
        logger.warn(
          { event: "adoption_failed", err: String(err) },
          "uploads not adopted into the signed-in account",
        );
      }
    }

    if (isAuthEnabled()) await applyCreditGrants(userId);
    return forClient;
  }

  if (isSignOut(pathname)) {
    const rotated = new Response(response.body, response);
    rotated.headers.append(
      "Set-Cookie",
      [
        `${SESSION_COOKIE}=${signSessionId(newSessionId())}`,
        "Path=/",
        "HttpOnly",
        "SameSite=Lax",
        `Max-Age=${ONE_YEAR_SECONDS}`,
        process.env.NODE_ENV === "production" ? "Secure" : "",
      ]
        .filter(Boolean)
        .join("; "),
    );
    return rotated;
  }

  return response;
}

/** Neither grant may break a sign-in. A missed top-up is repaired the next time
 * the user signs in; a sign-in that fails because the ledger was unavailable is
 * a locked-out account. */
async function applyCreditGrants(userId: string): Promise<void> {
  try {
    await grantWelcome(userId);
    await grantMonthlyReplenishment(userId);
  } catch (err) {
    logger.warn(
      { event: "credit_grant_on_signin_failed", err: String(err) },
      "credit grants skipped for this sign-in",
    );
  }
}
