import { NextResponse } from "next/server";
import { verifySession } from "@/lib/auth/dal";
import { AUTH_DISABLED_MESSAGE, isAuthEnabled } from "@/lib/auth/config";
import type { PublicUser } from "@/lib/auth/dto";

/**
 * API routes answer 401 JSON, while library *pages* redirect to /login. Three
 * surfaces, three deliberately different answers — the third being #2's
 * capability documents, which answer 404 so a 403 cannot confirm an id exists.
 *
 * Returns either the user or the response to send, so a caller reads as:
 *   const auth = await requireUserApi();
 *   if ("response" in auth) return auth.response;
 */
export async function requireUserApi(): Promise<{ user: PublicUser } | { response: Response }> {
  if (!isAuthEnabled()) {
    return { response: NextResponse.json({ error: AUTH_DISABLED_MESSAGE }, { status: 503 }) };
  }
  const user = await verifySession();
  if (!user) {
    return {
      response: NextResponse.json({ error: "Sign in to use your library." }, { status: 401 }),
    };
  }
  return { user };
}
