import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { logger } from "@/lib/log/logger";

/**
 * ORCID OAuth, used for one purpose: proving that the person holding this
 * account holds that ORCID iD.
 *
 * A self-asserted iD typed into a box proves nothing and would be trivially
 * abused — someone could claim a prolific author's record and mint credits
 * against work they did not do. The `/authenticate` scope is the smallest one
 * that answers the question: it returns the iD and nothing else. Reading the
 * public record afterwards needs no token at all.
 */

const AUTHORIZE_PATH = "/oauth/authorize";
const TOKEN_PATH = "/oauth/token";
export const STATE_COOKIE = "scholastic_orcid_state";

/** Sandbox (`https://sandbox.orcid.org`) is a different registry with different
 * iDs, so it is configured rather than guessed. */
function orcidBase(): string {
  return process.env.ORCID_BASE_URL ?? "https://orcid.org";
}

export function isOrcidConfigured(): boolean {
  return Boolean(process.env.ORCID_CLIENT_ID && process.env.ORCID_CLIENT_SECRET);
}

export const ORCID_DISABLED_MESSAGE =
  "ORCID verification is not enabled on this instance (set ORCID_CLIENT_ID and " +
  "ORCID_CLIENT_SECRET — see SETUP.md).";

function stateSecret(): string {
  // Reuses the app's existing cookie-signing secret rather than adding another
  // one to configure. Falls back the same way session.ts does.
  return process.env.SESSION_SECRET ?? process.env.BETTER_AUTH_SECRET ?? "orcid-state-dev-secret";
}

/**
 * State is signed rather than stored: the callback must be able to prove the
 * request it is answering is one this app started, and a signed value needs no
 * server-side table to check against.
 */
export function signState(nonce: string): string {
  const mac = createHmac("sha256", stateSecret()).update(nonce).digest("hex");
  return `${nonce}.${mac}`;
}

export function verifyState(value: string | undefined, presented: string | undefined): boolean {
  if (!value || !presented || value !== presented) return false;
  const separator = value.lastIndexOf(".");
  if (separator <= 0) return false;
  const nonce = value.slice(0, separator);
  const mac = Buffer.from(value.slice(separator + 1), "hex");
  const expected = Buffer.from(
    createHmac("sha256", stateSecret()).update(nonce).digest("hex"),
    "hex",
  );
  return mac.length === expected.length && timingSafeEqual(mac, expected);
}

export function newState(): string {
  return signState(randomBytes(16).toString("base64url"));
}

export function authorizeUrl(redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.ORCID_CLIENT_ID!,
    response_type: "code",
    scope: "/authenticate",
    redirect_uri: redirectUri,
    state,
  });
  return `${orcidBase()}${AUTHORIZE_PATH}?${params.toString()}`;
}

export interface OrcidToken {
  orcid: string;
  name: string | null;
}

/** Exchanges the authorization code. The access token is deliberately not
 * returned or stored: everything this feature reads afterwards is on ORCID's
 * public API, and a stored token is a credential to protect for no benefit. */
export async function exchangeCode(code: string, redirectUri: string): Promise<OrcidToken | null> {
  const body = new URLSearchParams({
    client_id: process.env.ORCID_CLIENT_ID!,
    client_secret: process.env.ORCID_CLIENT_SECRET!,
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
  });

  try {
    const response = await fetch(`${orcidBase()}${TOKEN_PATH}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body,
    });
    if (!response.ok) {
      logger.warn(
        { event: "orcid_token_exchange_failed", status: response.status },
        "ORCID token exchange rejected",
      );
      return null;
    }
    const json = (await response.json()) as { orcid?: string; name?: string };
    if (!json.orcid) return null;
    return { orcid: json.orcid, name: json.name ?? null };
  } catch (err) {
    logger.warn({ event: "orcid_token_exchange_error", err: String(err) }, "ORCID exchange failed");
    return null;
  }
}

/** 0000-0002-1825-0097 — four groups of four, last character may be X. */
export function isWellFormedOrcid(value: string): boolean {
  return /^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/.test(value);
}
