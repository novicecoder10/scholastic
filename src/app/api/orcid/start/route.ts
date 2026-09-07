import { NextRequest, NextResponse } from "next/server";
import { requireUserApi } from "@/lib/auth/apiGuard";
import {
  authorizeUrl,
  isOrcidConfigured,
  newState,
  ORCID_DISABLED_MESSAGE,
  STATE_COOKIE,
} from "@/lib/orcid/oauth";

export const runtime = "nodejs";

/** The redirect URI must match what is registered with ORCID exactly, so it is
 * derived from the request rather than assembled from guesses about the host. */
export function callbackUrl(request: NextRequest): string {
  return new URL("/api/orcid/callback", request.nextUrl.origin).toString();
}

export async function GET(request: NextRequest) {
  const auth = await requireUserApi();
  if ("response" in auth) return auth.response;
  if (!isOrcidConfigured()) {
    return NextResponse.json({ error: ORCID_DISABLED_MESSAGE }, { status: 503 });
  }

  const state = newState();
  const response = NextResponse.redirect(authorizeUrl(callbackUrl(request), state));
  response.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    // Long enough to sign in at ORCID, short enough that a stale state cookie
    // is not lying around afterwards.
    maxAge: 600,
  });
  return response;
}
