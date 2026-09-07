import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { requireUserApi } from "@/lib/auth/apiGuard";
import { getDb } from "@/lib/db/client";
import { orcidIdentity } from "@/lib/db/schema";
import {
  exchangeCode,
  isOrcidConfigured,
  isWellFormedOrcid,
  ORCID_DISABLED_MESSAGE,
  STATE_COOKIE,
  verifyState,
} from "@/lib/orcid/oauth";
import { logger } from "@/lib/log/logger";

export const runtime = "nodejs";

/** Every outcome lands back on /credits with a message, because that is the
 * page the user started from and the only one where the result means anything. */
function back(request: NextRequest, status: string): NextResponse {
  const url = new URL("/credits", request.nextUrl.origin);
  url.searchParams.set("orcid", status);
  const response = NextResponse.redirect(url);
  response.cookies.delete(STATE_COOKIE);
  return response;
}

export async function GET(request: NextRequest) {
  const auth = await requireUserApi();
  if ("response" in auth) return auth.response;
  if (!isOrcidConfigured()) {
    return NextResponse.json({ error: ORCID_DISABLED_MESSAGE }, { status: 503 });
  }

  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state") ?? undefined;
  const cookieState = request.cookies.get(STATE_COOKIE)?.value;

  // A callback whose state does not match one this app issued is not a failed
  // verification, it is someone else's request — refused without touching
  // anything.
  if (!verifyState(cookieState, state)) return back(request, "state");
  if (!code) return back(request, "denied");

  const redirectUri = new URL("/api/orcid/callback", request.nextUrl.origin).toString();
  const token = await exchangeCode(code, redirectUri);
  if (!token || !isWellFormedOrcid(token.orcid)) return back(request, "failed");

  try {
    const existing = await getDb()
      .select({ userId: orcidIdentity.userId })
      .from(orcidIdentity)
      .where(eq(orcidIdentity.orcid, token.orcid))
      .limit(1);

    // One iD, one account. Two accounts claiming the same record would let a
    // single publication history mint credits twice.
    if (existing[0] && existing[0].userId !== auth.user.id) return back(request, "taken");

    await getDb()
      .insert(orcidIdentity)
      .values({ userId: auth.user.id, orcid: token.orcid })
      .onConflictDoUpdate({
        target: orcidIdentity.userId,
        set: { orcid: token.orcid, verifiedAt: new Date() },
      });
  } catch (err) {
    logger.error({ event: "orcid_link_failed", err: String(err) }, "ORCID link failed");
    return back(request, "failed");
  }

  return back(request, "linked");
}
