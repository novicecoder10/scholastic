import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { document } from "@/lib/db/schema";
import { verifySession } from "@/lib/auth/dal";
import { getOrCreateSessionId, readSessionId } from "@/lib/documents/session";
import { logger } from "@/lib/log/logger";

/**
 * Who owns a thing. Either a signed-in account or the browser itself.
 *
 * #2's `scholastic_sid` and better-auth's session cookie are NOT duplicates and
 * must never be merged:
 *
 *   scholastic_sid       identifies this BROWSER, whether or not anyone is signed in
 *   better-auth session  identifies this USER, only while signed in
 *
 * Collapsing them produces one of two bugs, both bad: uploads vanish on sign
 * out, or the next person to use a shared browser inherits the previous user's
 * library. Every ownership check in the application goes through the resolvers
 * below; no route handler and no Server Component reads either cookie directly.
 */
export type Owner = { kind: "user"; userId: string } | { kind: "anonymous"; sessionId: string };

/** For Route Handlers and Server Actions, which may mint a cookie. */
export async function resolveOwner(): Promise<Owner> {
  const user = await verifySession();
  if (user) return { kind: "user", userId: user.id };
  return { kind: "anonymous", sessionId: await getOrCreateSessionId() };
}

/**
 * Read-only variant for Server Components, where `cookies()` cannot be written.
 * Returns null for an anonymous visitor with no cookie yet — there is nothing
 * for them to own, and minting an identity during a render is not allowed.
 */
export async function readOwner(): Promise<Owner | null> {
  const user = await verifySession();
  if (user) return { kind: "user", userId: user.id };
  const sessionId = await readSessionId();
  return sessionId ? { kind: "anonymous", sessionId } : null;
}

/**
 * Moves an anonymous browser session's uploads onto the account that just
 * signed in, so a visitor who uploaded three papers and then created an account
 * does not lose them.
 *
 * `AND user_id IS NULL` is the entire security of this operation, not an
 * optimization. Without it, a second person signing in on a shared browser
 * would claim the first person's documents — the rows still carry that
 * browser's `ownerSessionId` forever.
 *
 * Returns how many rows moved. Best-effort: a failure here must not fail the
 * sign-in itself, since the documents remain reachable anonymously either way.
 */
export async function claimAnonymousSession(userId: string, sessionId: string): Promise<number> {
  try {
    const claimed = await getDb()
      .update(document)
      .set({ userId, updatedAt: new Date() })
      .where(and(eq(document.ownerSessionId, sessionId), isNull(document.userId)))
      .returning({ documentId: document.documentId });

    if (claimed.length > 0) {
      logger.info(
        { event: "anonymous_documents_claimed", userId, count: claimed.length },
        "adopted anonymous uploads into an account",
      );
    }

    // #7's matrices are owned the same way and adopted by the same rule. The
    // import is dynamic so this module stays importable by anything that only
    // needs owner resolution.
    try {
      const { claimMatrices } = await import("@/lib/extraction/repository");
      const matrices = await claimMatrices(userId, sessionId);
      if (matrices > 0) {
        logger.info(
          { event: "anonymous_matrices_claimed", userId, count: matrices },
          "adopted anonymous matrices into an account",
        );
      }
    } catch (err) {
      logger.warn({ event: "matrix_claim_failed", err: String(err) }, "matrices not adopted");
    }

    return claimed.length;
  } catch (err) {
    logger.warn(
      { event: "anonymous_claim_failed", userId, err: String(err) },
      "could not adopt anonymous uploads; they remain reachable by session",
    );
    return 0;
  }
}
