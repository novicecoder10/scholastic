import type { RawWork, SearchOptions } from "@/lib/providers/types";
import { ProviderSkippedError, ProviderTimeoutError } from "@/lib/providers/types";
import { getEnabledProviders } from "@/lib/providers/registry";
import { withResilience } from "@/lib/resilience/withResilience";
import type { ProviderCallStatus } from "@/lib/types/search";
import { logger } from "@/lib/log/logger";

export interface ProviderFanOutResult {
  providerId: string;
  displayName: string;
  status: ProviderCallStatus;
  works: RawWork[];
  totalCount: number | null;
  latencyMs: number;
  errorMessage?: string;
}

/** Whole-fan-out wall-clock budget, independent of any one provider's own timeout. */
const FAN_OUT_DEADLINE_MS = 9000;
const FAN_OUT_DEADLINE = Symbol("fan-out-deadline");

function buildCacheKey(providerId: string, options: SearchOptions): string {
  return JSON.stringify({
    providerId,
    query: options.query.trim().toLowerCase(),
    page: options.page ?? 1,
    perPage: options.perPage ?? 20,
    yearFrom: options.yearFrom ?? null,
    yearTo: options.yearTo ?? null,
  });
}

/**
 * Fans out a search to every enabled provider in parallel, wrapping each call in
 * withResilience so retries/timeout/circuit-breaking/caching apply uniformly.
 * Never throws for individual provider failures — a provider failing or timing
 * out is reflected in that provider's own result entry, not a rejected promise
 * for the whole fan-out.
 */
export async function fanOutSearch(
  options: SearchOptions,
  { deadlineMs = FAN_OUT_DEADLINE_MS }: { deadlineMs?: number } = {},
): Promise<ProviderFanOutResult[]> {
  const providers = getEnabledProviders();

  // Every provider already has its own timeout and retry budget, but those
  // compose badly: a provider that times out on all three attempts costs ~19s,
  // and Promise.allSettled makes every user wait for it even when the other
  // eight answered in under 4s. Past this deadline we return what we have and
  // mark the stragglers — the same graceful-degradation contract already
  // applied to provider errors. Stragglers keep running; withResilience caches
  // a late success, so it's there for the next search rather than wasted.
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
  const deadlineReached = new Promise<typeof FAN_OUT_DEADLINE>((resolve) => {
    deadlineTimer = setTimeout(() => resolve(FAN_OUT_DEADLINE), deadlineMs);
  });

  const settled = await Promise.allSettled(
    providers.map(async (provider) => {
      const start = Date.now();
      const cacheKey = buildCacheKey(provider.meta.id, options);

      try {
        const raced = await Promise.race([
          withResilience(
            provider.meta.id,
            (ctx) => provider.search({ ...options, signal: ctx.signal }),
            {
              timeoutMs: provider.meta.defaultTimeoutMs,
              cacheKey,
            },
          ),
          deadlineReached,
        ]);

        if (raced === FAN_OUT_DEADLINE) {
          return {
            providerId: provider.meta.id,
            displayName: provider.meta.displayName,
            status: "timeout" as ProviderCallStatus,
            works: [],
            totalCount: null,
            latencyMs: Date.now() - start,
            errorMessage: `still running when the ${deadlineMs}ms fan-out budget elapsed`,
          };
        }
        const result = raced;

        return {
          providerId: provider.meta.id,
          displayName: provider.meta.displayName,
          status: "ok" as const,
          works: result.works,
          totalCount: result.totalCount,
          latencyMs: Date.now() - start,
        };
      } catch (err) {
        const latencyMs = Date.now() - start;
        if (err instanceof ProviderSkippedError) {
          return {
            providerId: provider.meta.id,
            displayName: provider.meta.displayName,
            status: "skipped" as const,
            works: [],
            totalCount: null,
            latencyMs,
            errorMessage: err.message,
          };
        }
        const isTimeout = err instanceof ProviderTimeoutError;
        return {
          providerId: provider.meta.id,
          displayName: provider.meta.displayName,
          status: (isTimeout ? "timeout" : "error") as ProviderCallStatus,
          works: [],
          totalCount: null,
          latencyMs,
          errorMessage: err instanceof Error ? err.message : String(err),
        };
      }
    }),
  );
  clearTimeout(deadlineTimer);

  const results = settled.map((s) => {
    if (s.status === "fulfilled") return s.value;
    // Should be unreachable: every branch above catches and resolves rather than
    // rejects. Fall back to a generic error entry rather than losing the provider.
    logger.error(
      { event: "orchestrator_unexpected_rejection", reason: s.reason },
      "unexpected provider rejection",
    );
    return {
      providerId: "unknown",
      displayName: "unknown",
      status: "error" as const,
      works: [],
      totalCount: null,
      latencyMs: 0,
      errorMessage: String(s.reason),
    };
  });

  return results;
}
