import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { logger } from "@/lib/log/logger";

export const SESSION_COOKIE = "scholastic_sid";
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

declare global {
  var __scholasticEphemeralSessionSecret: string | undefined;
}

/**
 * A missing SESSION_SECRET degrades rather than crashing: a random secret is
 * minted so the app still works, but every existing cookie stops verifying on
 * restart and uploads become unreachable. That is a real cost, so it is warned
 * about loudly and documented in KNOWN_LIMITATIONS.md.
 *
 * The fallback lives on `globalThis`, not in a module-level `let`, and that is
 * load-bearing rather than defensive. Next bundles Route Handlers and Server
 * Components into separate module graphs, so a module-scoped secret is minted
 * TWICE — once per graph — and a cookie signed by `POST /api/documents` then
 * fails to verify in the `/reader/[documentId]` Server Component, which
 * answers 404 to the very session that just uploaded the file. Same reasoning
 * as the connection reuse in lib/db/client.ts.
 */
function sessionSecret(): string {
  const configured = process.env.SESSION_SECRET;
  if (configured) return configured;
  if (!globalThis.__scholasticEphemeralSessionSecret) {
    globalThis.__scholasticEphemeralSessionSecret = randomBytes(32).toString("hex");
    logger.warn(
      { event: "session_secret_missing" },
      "SESSION_SECRET is not set — using an ephemeral secret. Uploaded documents will become unreachable when the server restarts.",
    );
  }
  return globalThis.__scholasticEphemeralSessionSecret;
}

export function signSessionId(sessionId: string): string {
  const mac = createHmac("sha256", sessionSecret()).update(sessionId).digest("hex");
  return `${sessionId}.${mac}`;
}

/** Returns the session id only if the signature verifies. */
export function verifySessionCookie(value: string): string | null {
  const separator = value.lastIndexOf(".");
  if (separator <= 0) return null;
  const sessionId = value.slice(0, separator);
  const presented = value.slice(separator + 1);

  const expected = createHmac("sha256", sessionSecret()).update(sessionId).digest("hex");
  const a = Buffer.from(presented, "hex");
  const b = Buffer.from(expected, "hex");
  // timingSafeEqual throws on a length mismatch, which a forged cookie can
  // trivially cause, so the lengths are compared first.
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return sessionId;
}

export function newSessionId(): string {
  return randomBytes(18).toString("base64url");
}

/**
 * Reads the signed session cookie, minting and setting one when absent or
 * invalid. Must be called from a Route Handler or Server Action — `cookies()`
 * is read-only inside a Server Component render.
 */
export async function getOrCreateSessionId(): Promise<string> {
  const jar = await cookies();
  const existing = jar.get(SESSION_COOKIE)?.value;
  if (existing) {
    const verified = verifySessionCookie(existing);
    if (verified) return verified;
  }

  const sessionId = newSessionId();
  jar.set(SESSION_COOKIE, signSessionId(sessionId), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: ONE_YEAR_SECONDS,
  });
  return sessionId;
}

/** Read-only variant, safe in a Server Component. Returns null when unset. */
export async function readSessionId(): Promise<string | null> {
  const jar = await cookies();
  const existing = jar.get(SESSION_COOKIE)?.value;
  return existing ? verifySessionCookie(existing) : null;
}
