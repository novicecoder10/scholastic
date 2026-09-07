import { createOpenAiCompatibleProvider } from "@/lib/ai/llm/openAiCompatible";
import type { LlmProvider } from "@/lib/ai/llm/types";

/**
 * Capacity donated as an **endpoint** rather than a key.
 *
 * Two kinds, and the distinction is about custody, not technology:
 *
 * - `outpost` — a relay a sponsor runs themselves. An institution whose grant
 *   terms forbid handing its API key to anyone can still donate the quota
 *   behind it: it exposes a scoped OpenAI-compatible URL, enforces its own
 *   spend limits locally, and revokes access by turning the relay off. We never
 *   hold the provider key, which is the point.
 * - `node` — GPU capacity, usually a university cluster running vLLM or SGLang,
 *   donated on the hours it is otherwise idle.
 *
 * Neither adds a secret to the database. A base URL is a URL, and the bearer
 * token for a relay is still held the only way this project holds a
 * credential — in the environment, named by `credentialRef`. A node on a
 * private network often needs no credential at all, which is the one case
 * where `credentialRef` may be null.
 */

export const ENDPOINT_PROVIDER_IDS = ["outpost", "node"] as const;
export type EndpointProviderId = (typeof ENDPOINT_PROVIDER_IDS)[number];

export function isEndpointProvider(providerId: string): providerId is EndpointProviderId {
  return (ENDPOINT_PROVIDER_IDS as readonly string[]).includes(providerId);
}

export interface EndpointRow {
  id: string;
  providerId: string;
  credentialRef: string | null;
  baseUrl: string | null;
  servedModel: string | null;
  activeHoursUtc: string | null;
  activeDays: string | null;
}

const WINDOW = /^([01]\d|2[0-3]):([0-5]\d)-([01]\d|2[0-3]):([0-5]\d)$/;

interface Window {
  startMinutes: number;
  endMinutes: number;
}

/** `HH:MM-HH:MM`, UTC. Null for anything unparseable — a malformed window is
 * treated as "no window", never as "closed": a typo in an operator's schedule
 * should not silently take donated capacity out of the pool. */
export function parseWindow(spec: string | null): Window | null {
  if (!spec) return null;
  const match = spec.trim().match(WINDOW);
  if (!match) return null;
  const startMinutes = Number(match[1]) * 60 + Number(match[2]);
  const endMinutes = Number(match[3]) * 60 + Number(match[4]);
  if (startMinutes === endMinutes) return null; // A zero-length window means "always".
  return { startMinutes, endMinutes };
}

function isoWeekday(date: Date): number {
  const day = date.getUTCDay();
  return day === 0 ? 7 : day;
}

function parseDays(spec: string | null): Set<number> | null {
  if (!spec) return null;
  const days = spec
    .split(",")
    .map((part) => Number.parseInt(part.trim(), 10))
    .filter((day) => Number.isInteger(day) && day >= 1 && day <= 7);
  return days.length > 0 ? new Set(days) : null;
}

/**
 * Whether a scheduled source may be used right now.
 *
 * A window that wraps past midnight (`18:00-06:00`, the shape almost every
 * off-peak donation takes) is measured against the day it **opened** on, not
 * the day it is currently. Otherwise a Friday-evening donation would stop at
 * midnight and a Saturday-morning one the operator never offered would start.
 */
export function withinSchedule(
  row: Pick<EndpointRow, "activeHoursUtc" | "activeDays">,
  now = new Date(),
): boolean {
  const window = parseWindow(row.activeHoursUtc);
  const days = parseDays(row.activeDays);
  if (!window && !days) return true;

  const minutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  let openedOn = now;

  if (window) {
    const wraps = window.endMinutes < window.startMinutes;
    const open = wraps
      ? minutes >= window.startMinutes || minutes < window.endMinutes
      : minutes >= window.startMinutes && minutes < window.endMinutes;
    if (!open) return false;
    if (wraps && minutes < window.endMinutes) {
      openedOn = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    }
  }

  return days ? days.has(isoWeekday(openedOn)) : true;
}

/** Sponsors give the API root (`https://relay.example/v1`), the way every
 * OpenAI-compatible client asks for it. The factory wants the full path. */
export function completionsUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  return trimmed.endsWith("/chat/completions") ? trimmed : `${trimmed}/chat/completions`;
}

/**
 * Builds a provider for one endpoint row, or null if the row cannot serve —
 * no URL, no model, or a credential the environment does not hold.
 *
 * The provider id is namespaced per source (`outpost:mp-lab`) so the circuit
 * breaker in `withResilience` tracks each donated endpoint separately. One
 * lab's relay going down must not open the breaker on another's.
 */
export function endpointProvider(row: EndpointRow): LlmProvider | null {
  if (!isEndpointProvider(row.providerId)) return null;
  if (!row.baseUrl || !row.servedModel) return null;
  if (row.credentialRef && !process.env[row.credentialRef]) return null;

  return createOpenAiCompatibleProvider({
    providerId: `${row.providerId}:${row.id}`,
    displayName: row.id,
    baseUrl: completionsUrl(row.baseUrl),
    apiKeyEnvVar: row.credentialRef,
    // A donated node runs one model; there is no cheap tier to fall back to,
    // and pretending otherwise would route a bulk job to a 70B model on a
    // cluster that offered its idle hours in good faith.
    defaultCheapModel: row.servedModel,
    defaultCapableModel: row.servedModel,
  });
}
