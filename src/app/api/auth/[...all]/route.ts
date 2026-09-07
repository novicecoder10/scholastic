import { NextRequest, NextResponse } from "next/server";
import { AUTH_DISABLED_MESSAGE, getAuth, isAuthEnabled } from "@/lib/auth/config";
import { afterAuthResponse } from "@/lib/auth/adoption";

export const runtime = "nodejs";

/**
 * better-auth's whole HTTP surface. Wrapped rather than exported directly for
 * two reasons: an instance with no `BETTER_AUTH_SECRET` must answer a clear 503
 * instead of throwing on construction, and a successful sign-in or sign-up has
 * to trigger anonymous-session adoption before the response leaves.
 */
async function handle(request: NextRequest): Promise<Response> {
  if (!isAuthEnabled()) {
    return NextResponse.json({ error: AUTH_DISABLED_MESSAGE }, { status: 503 });
  }
  const response = await getAuth().handler(request);
  return afterAuthResponse(request, response);
}

export const GET = handle;
export const POST = handle;
