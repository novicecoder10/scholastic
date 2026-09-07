import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { redirect, unstable_rethrow } from "next/navigation";
import { getAuth, isAuthEnabled } from "@/lib/auth/config";
import type { PublicUser } from "@/lib/auth/dto";
import { logger } from "@/lib/log/logger";

/**
 * The single place the application asks "who is signed in?".
 *
 * Wrapped in React `cache()` so a Server Component tree that checks the session
 * in a layout, a page, and two children costs one lookup per render pass rather
 * than four — the pattern the Next authentication guide recommends.
 *
 * Returns null rather than throwing when accounts are disabled, so every caller
 * has one code path for "no user" whether that is because nobody signed in or
 * because this instance has no auth at all.
 */
export const verifySession = cache(async (): Promise<PublicUser | null> => {
  if (!isAuthEnabled()) return null;
  try {
    const result = await getAuth().api.getSession({ headers: await headers() });
    if (!result?.user) return null;
    const { id, name, email, emailVerified, image } = result.user;
    return { id, name, email, emailVerified, image: image ?? null };
  } catch (err) {
    // Next signals "this route cannot be static, it read headers" by throwing.
    // Swallowing that would tell the prerenderer the visitor is signed out
    // instead of letting it bail out to dynamic rendering, so it is rethrown
    // before anything else is considered a failure.
    unstable_rethrow(err);
    // A session lookup failing (database down, malformed cookie) must read as
    // "signed out", never as a crash on a page an anonymous visitor can reach.
    logger.warn({ event: "session_verify_failed", err: String(err) }, "session lookup failed");
    return null;
  }
});

/**
 * For pages that only make sense signed in. Redirects rather than rendering a
 * 401: `unauthorized()` is experimental in Next 16 (it needs
 * `experimental.authInterrupts`), and an error page is the wrong answer for
 * someone who simply has not signed in yet.
 */
export async function requireUser(nextPath: string): Promise<PublicUser> {
  const user = await verifySession();
  if (!user) redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  return user;
}
