import { and, eq, isNotNull, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { capacitySource } from "@/lib/db/schema";
import {
  anthropicLlmProvider,
  geminiLlmProvider,
  getActiveLlmProvider,
  groqLlmProvider,
  mistralLlmProvider,
  openrouterLlmProvider,
  sambanovaLlmProvider,
} from "@/lib/ai/llm";
import type { CompleteParams, LlmProvider } from "@/lib/ai/llm/types";
import { endpointProvider, isEndpointProvider, withinSchedule } from "@/lib/capacity/endpoints";
import { logger } from "@/lib/log/logger";

/**
 * The capacity pool: which real API key serves a request.
 *
 * `capacity_source` rows are optional. An instance that has never inserted one
 * behaves exactly as it did before #6 — static best-available selection against
 * whatever keys are in the environment. The pool is an accounting layer over
 * that, not a replacement for it.
 */

/** `capacity_source.provider_id` → the provider implementation it describes. */
const PROVIDERS: Record<string, LlmProvider> = {
  anthropic: anthropicLlmProvider,
  groq: groqLlmProvider,
  sambanova: sambanovaLlmProvider,
  mistral: mistralLlmProvider,
  openrouter: openrouterLlmProvider,
  gemini: geminiLlmProvider,
};

/** The existing static preference order, live-verified — see `lib/ai/llm`. */
const PREFERENCE = ["anthropic", "groq", "sambanova", "mistral", "openrouter", "gemini"];

export interface SelectedCapacity {
  /** Dispatches to the first source that answers, in the ranked order. */
  provider: LlmProvider;
  /** The source that actually served the last completed call — read it *after*
   * the call, not before, since a failover changes the answer. Null when
   * selection fell back to the static order: there is no row to bill the
   * tokens against, and that is a normal state, not an error. */
  servedSourceId(): string | null;
  /** The sponsor to credit for the last completed call, when they asked to be
   * named publicly. Null for operator capacity and for anonymous donors. */
  servedSponsor(): string | null;
}

export interface CapacitySourceRow {
  id: string;
  label: string;
  providerId: string;
  credentialRef: string | null;
  sponsorName: string | null;
  sponsorUrl: string | null;
  isPublic: boolean;
  monthlyTokenCap: number | null;
  tokensUsedPeriod: number;
  periodStartsAt: Date;
  status: string;
  baseUrl: string | null;
  servedModel: string | null;
  activeHoursUtc: string | null;
  activeDays: string | null;
  dormantUntil: Date | null;
}

/** A source is only usable if the environment actually holds the key its
 * `credentialRef` names. The database records that a key should exist; it never
 * records the key.
 *
 * A null `credentialRef` is accepted only for an endpoint — a cluster node on a
 * private network genuinely has no credential. For a named provider it means
 * the row is incomplete, and an incomplete row must not be tried. */
function hasCredential(row: { credentialRef: string | null; providerId: string }): boolean {
  if (row.credentialRef === null) return isEndpointProvider(row.providerId);
  return Boolean(process.env[row.credentialRef]);
}

function periodHasRolledOver(periodStartsAt: Date, now: Date): boolean {
  return (
    periodStartsAt.getUTCFullYear() !== now.getUTCFullYear() ||
    periodStartsAt.getUTCMonth() !== now.getUTCMonth()
  );
}

/**
 * Ranks eligible sources: **sponsor capacity before operator capacity**, so
 * donated quota is actually consumed rather than sitting unused behind the
 * operator's own key; then the static preference order among equals.
 */
export function rankSources(
  rows: CapacitySourceRow[],
  now = new Date(),
  /** False for anonymous visitors: sponsors donate capacity for researchers,
   * not for an unauthenticated firehose, so a signed-out session draws from
   * operator capacity only. */
  sponsorEligible = true,
): CapacitySourceRow[] {
  return rows
    .filter((row) => {
      if (!sponsorEligible && row.sponsorName) return false;
      if (row.status === "disabled") return false;
      if (!PROVIDERS[row.providerId] && !isEndpointProvider(row.providerId)) return false;
      if (!hasCredential(row)) return false;
      // Tripped out of rotation by the dispatcher. Unlike `exhausted` this is
      // a clock, not a calendar month: a rate limit clears in minutes.
      if (row.dormantUntil && row.dormantUntil > now) return false;
      // Donated cluster hours. A node outside its window is not broken, it is
      // simply not ours right now.
      if (!withinSchedule(row, now)) return false;
      const rolled = periodHasRolledOver(row.periodStartsAt, now);
      if (row.status === "exhausted" && !rolled) return false;
      if (row.monthlyTokenCap == null) return true;
      return rolled || row.tokensUsedPeriod < row.monthlyTokenCap;
    })
    .sort((a, b) => {
      const sponsored = Number(Boolean(b.sponsorName)) - Number(Boolean(a.sponsorName));
      if (sponsored !== 0) return sponsored;
      return orderIndex(a.providerId) - orderIndex(b.providerId);
    });
}

/** Endpoints rank after the named providers among otherwise-equal sources.
 * Not a judgement on donated hardware — the six named backends are the ones
 * whose behaviour this app has actually been verified against. */
function orderIndex(providerId: string): number {
  const index = PREFERENCE.indexOf(providerId);
  return index === -1 ? PREFERENCE.length : index;
}

/** Statuses that mean "this capacity is spent or shut off", from the provider's
 * own mouth: out of quota, out of budget, key revoked. */
const DORMANT_STATUSES = new Set([401, 402, 403, 429]);

/** A rate limit clears on its own in seconds; a revoked or unfunded key needs a
 * human, so it is retried rarely rather than never. */
const DORMANCY_MS: Record<number, number> = {
  429: 5 * 60_000,
  401: 6 * 60 * 60_000,
  402: 6 * 60 * 60_000,
  403: 6 * 60 * 60_000,
};

/**
 * The HTTP status behind a provider error, or null if it was not an HTTP
 * failure at all (a timeout, a socket reset).
 *
 * Read from the SDK's own field where there is one, and otherwise from the
 * message the OpenAI-compatible factory throws — which ends in
 * "failed with status 429". Parsing a message is not something to be proud of,
 * but the alternative is a typed error class threaded through six adapters to
 * carry one integer.
 */
export function dispatchStatus(err: unknown): number | null {
  if (typeof err === "object" && err !== null && "status" in err) {
    const status = (err as { status?: unknown }).status;
    if (typeof status === "number") return status;
  }
  const match = /status (\d{3})/.exec(err instanceof Error ? err.message : String(err));
  return match ? Number(match[1]) : null;
}

/** Whether to move to the next source rather than fail the request. A 400 is
 * the caller's fault and will fail identically everywhere; a 429 is this
 * source's, and someone else's key can answer it. */
export function shouldFailOver(status: number | null): boolean {
  return status === null || status >= 500 || DORMANT_STATUSES.has(status);
}

export interface Candidate {
  row: CapacitySourceRow | null;
  provider: LlmProvider;
}

/** The provider a candidate row resolves to, or null if it cannot serve. */
function providerFor(row: CapacitySourceRow): LlmProvider | null {
  if (isEndpointProvider(row.providerId)) return endpointProvider(row);
  const provider = PROVIDERS[row.providerId];
  // `isConfigured()` reads the provider's own env var, which may differ from
  // `credentialRef` on an instance holding several keys for one provider.
  return provider?.isConfigured() ? provider : null;
}

/**
 * Wraps the ranked candidates in one provider that tries them in order.
 *
 * Failover is the whole reason the pool exists. A sponsor's key hitting its
 * daily limit at 11pm should cost the next researcher a few hundred
 * milliseconds, not an error page — the capacity commons is only as good as
 * what happens when one contributor runs dry.
 *
 * A streamed answer can only fail over **before its first token**. Once bytes
 * have reached the reader, restarting on another backend would splice two
 * different answers together, and a half-sentence repeated in a new voice is
 * worse than an honest failure.
 */
export function createDispatchingProvider(
  candidates: Candidate[],
  state: { served: Candidate },
): LlmProvider {
  const primary = candidates[0].provider;

  /** Which tier the caller asked for, so a failover uses the *next* backend's
   * model id rather than one it has never heard of. Callers pass
   * `provider.models.cheap` or `.capable`; anything else is treated as capable,
   * the safer of the two to be wrong about. */
  function tierOf(model: string): "cheap" | "capable" {
    return model === primary.models.cheap ? "cheap" : "capable";
  }

  function onFailure(candidate: Candidate, err: unknown, params: CompleteParams): boolean {
    const status = dispatchStatus(err);
    if (candidate.row && status !== null && DORMANT_STATUSES.has(status)) {
      void markDormant(candidate.row.id, status);
    }
    if (!shouldFailOver(status)) return false;
    logger.warn(
      {
        event: "capacity_failover",
        sourceId: candidate.row?.id ?? null,
        providerId: candidate.row?.providerId ?? null,
        status,
        model: params.model,
      },
      "capacity source failed — trying the next in the pool",
    );
    return true;
  }

  return {
    models: primary.models,
    isConfigured: () => true,

    async complete(params: CompleteParams): Promise<string> {
      const tier = tierOf(params.model);
      let last: unknown;
      for (const candidate of candidates) {
        state.served = candidate;
        try {
          return await candidate.provider.complete({
            ...params,
            model: candidate.provider.models[tier],
          });
        } catch (err) {
          last = err;
          if (!onFailure(candidate, err, params)) throw err;
        }
      }
      throw last;
    },

    async *streamComplete(params: CompleteParams): AsyncGenerator<string> {
      const tier = tierOf(params.model);
      let last: unknown;
      for (const candidate of candidates) {
        state.served = candidate;
        let started = false;
        try {
          for await (const chunk of candidate.provider.streamComplete({
            ...params,
            model: candidate.provider.models[tier],
          })) {
            started = true;
            yield chunk;
          }
          return;
        } catch (err) {
          last = err;
          if (started) throw err;
          if (!onFailure(candidate, err, params)) throw err;
        }
      }
      throw last;
    },
  };
}

/**
 * Picks the capacity that will serve this request, and the order to fall back
 * through if it cannot.
 *
 * Falls back to the static order whenever the pool cannot answer — no rows, no
 * eligible row, or an unreachable database. That is the same fail-open stance
 * the rest of #6 takes: a commons that stops serving because its bookkeeping is
 * offline is worse than one that occasionally undercounts.
 */
export async function selectCapacity(
  tier: string,
  { sponsorEligible = true }: { sponsorEligible?: boolean } = {},
): Promise<SelectedCapacity | null> {
  let rows: CapacitySourceRow[] = [];
  try {
    rows = await getDb().select().from(capacitySource);
  } catch (err) {
    logger.warn(
      { event: "capacity_pool_unavailable", err: String(err) },
      "capacity pool unreadable — falling back to static provider selection",
    );
  }

  const eligible = rankSources(rows, new Date(), sponsorEligible);
  const candidates: Candidate[] = [];
  for (const row of eligible) {
    const provider = providerFor(row);
    if (provider) candidates.push({ row, provider });
  }

  // The operator's own environment, last: it is the backstop that keeps the app
  // working on an instance with no pool at all.
  const fallback = getActiveLlmProvider();
  if (fallback && !candidates.some((c) => c.provider === fallback)) {
    candidates.push({ row: null, provider: fallback });
  }

  if (candidates.length === 0) return null;
  if (rows.length > 0 && eligible.length === 0) {
    logger.info(
      { event: "capacity_pool_no_eligible_source", tier },
      "no eligible capacity source — using static provider selection",
    );
  }

  const state = { served: candidates[0] };
  return {
    provider: createDispatchingProvider(candidates, state),
    servedSourceId: () => state.served.row?.id ?? null,
    servedSponsor: () =>
      state.served.row?.isPublic ? (state.served.row.sponsorName ?? null) : null,
  };
}

/**
 * Takes a source out of rotation until the clock passes, without touching its
 * token accounting.
 *
 * `status` records *why* it is out, so `--list` can tell an operator the
 * difference between "rate limited, back in five minutes" and "this key is
 * being refused, go and look at it". Best-effort: this runs while a user is
 * waiting on a request that has already moved to another source.
 */
export async function markDormant(sourceId: string, httpStatus: number): Promise<void> {
  const ms = DORMANCY_MS[httpStatus] ?? 5 * 60_000;
  try {
    await getDb()
      .update(capacitySource)
      .set({
        status: "dormant",
        dormantUntil: new Date(Date.now() + ms),
      })
      .where(and(eq(capacitySource.id, sourceId), sql`${capacitySource.status} <> 'disabled'`));
    logger.warn(
      { event: "capacity_source_dormant", sourceId, httpStatus, minutes: Math.round(ms / 60_000) },
      "capacity source tripped out of rotation",
    );
  } catch (err) {
    logger.warn(
      { event: "capacity_dormancy_write_failed", sourceId, err: String(err) },
      "could not record capacity dormancy",
    );
  }
}

/**
 * Bills tokens against the source that served the request, rolling the period
 * over first if the calendar month has changed, and flipping a source that
 * crosses its cap to `exhausted` so it is skipped until the next period.
 *
 * Best-effort by design: this runs on the usage callback, which must never
 * affect a response the user has already received.
 */
export async function recordCapacityUsage(sourceId: string, tokens: number): Promise<void> {
  if (tokens <= 0) return;

  // The month boundary is computed in SQL rather than passed as a JS Date.
  // A raw `sql` fragment carries no column type, so a Date reaches postgres.js
  // as an untyped parameter and fails to serialise —
  // "ERR_INVALID_ARG_TYPE … Received an instance of Date". Comparing
  // date_trunc to date_trunc also makes the rollover independent of whatever
  // timezone the Node process happens to run in, which a client-side
  // `new Date(Date.UTC(...))` was not.
  const rolled = sql`date_trunc('month', ${capacitySource.periodStartsAt}) < date_trunc('month', now())`;

  await getDb()
    .update(capacitySource)
    .set({
      // A source that just answered is demonstrably not dormant. Clearing the
      // clock here means a rate limit that lifted early is not honoured for
      // its full five minutes on the next request.
      dormantUntil: null,
      // One statement, so two concurrent calls cannot both read a pre-rollover
      // total and write it back.
      tokensUsedPeriod: sql`case when ${rolled}
        then ${tokens} else ${capacitySource.tokensUsedPeriod} + ${tokens} end`,
      periodStartsAt: sql`case when ${rolled}
        then date_trunc('month', now()) else ${capacitySource.periodStartsAt} end`,
      status: sql`case
        when ${capacitySource.status} = 'disabled' then 'disabled'
        when ${capacitySource.monthlyTokenCap} is null then 'active'
        when ${rolled}
          then case when ${tokens} >= ${capacitySource.monthlyTokenCap} then 'exhausted' else 'active' end
        when ${capacitySource.tokensUsedPeriod} + ${tokens} >= ${capacitySource.monthlyTokenCap}
          then 'exhausted'
        else 'active' end`,
    })
    .where(eq(capacitySource.id, sourceId));
}

/** Public sponsor list for `/sponsors`. Never includes `credentialRef` — the
 * env var name is operational detail, and publishing it tells a reader exactly
 * which variable to go looking for. */
export async function publicSponsors(): Promise<
  Array<{ label: string; sponsorName: string; sponsorUrl: string | null; tokensUsedPeriod: number }>
> {
  const rows = await getDb()
    .select({
      label: capacitySource.label,
      sponsorName: capacitySource.sponsorName,
      sponsorUrl: capacitySource.sponsorUrl,
      tokensUsedPeriod: capacitySource.tokensUsedPeriod,
    })
    .from(capacitySource)
    .where(and(eq(capacitySource.isPublic, true), isNotNull(capacitySource.sponsorName)));
  return rows
    .filter((r): r is typeof r & { sponsorName: string } => r.sponsorName !== null)
    .sort((a, b) => b.tokensUsedPeriod - a.tokensUsedPeriod);
}

/** Aggregate pool health for `/credits` and `/sponsors`: how much donated
 * capacity exists and how much of it is still available. */
export async function poolHealth(): Promise<{
  activeSources: number;
  sponsoredSources: number;
  exhaustedSources: number;
  dormantSources: number;
}> {
  const [row] = await getDb()
    .select({
      activeSources: sql<number>`count(*) filter (where ${capacitySource.status} = 'active')::int`,
      sponsoredSources: sql<number>`count(*) filter (where ${capacitySource.sponsorName} is not null)::int`,
      exhaustedSources: sql<number>`count(*) filter (where ${capacitySource.status} = 'exhausted')::int`,
      dormantSources: sql<number>`count(*) filter (where ${capacitySource.dormantUntil} > now())::int`,
    })
    .from(capacitySource);
  return row ?? { activeSources: 0, sponsoredSources: 0, exhaustedSources: 0, dormantSources: 0 };
}
