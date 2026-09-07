import { cache } from "@/lib/resilience/cache";
import { circuitBreaker } from "@/lib/resilience/circuitBreaker";
import { providerHealthStore } from "@/lib/resilience/healthStore";
import { persistHealthSnapshot } from "@/lib/resilience/persistHealthSnapshot";
import { backoffDelay, sleep } from "@/lib/resilience/retry";
import { ProviderSkippedError, ProviderTimeoutError } from "@/lib/providers/types";
import { providerLogger } from "@/lib/log/logger";

export interface ResilienceContext {
  signal: AbortSignal;
  /** Adapters that can read a rate-limit header call this to surface it on the health endpoint. */
  reportRateLimit: (remaining: number) => void;
}

export interface ResilienceOptions {
  timeoutMs?: number;
  maxRetries?: number;
  cacheTtlMs?: number;
  /** Omit to skip caching for this call. */
  cacheKey?: string;
}

const DEFAULT_TIMEOUT_MS = 6000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_CACHE_TTL_MS = 15 * 60_000;

/**
 * The single wrapper every provider call goes through, applied only by the
 * orchestrator (never by adapters themselves) so resilience behavior can never
 * be forgotten or reimplemented inconsistently per provider.
 */
export async function withResilience<T>(
  providerId: string,
  fn: (ctx: ResilienceContext) => Promise<T>,
  opts: ResilienceOptions = {},
): Promise<T> {
  const log = providerLogger(providerId);
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;

  if (opts.cacheKey) {
    const cached = cache.get<T>(opts.cacheKey);
    if (cached !== undefined) {
      log.info({ event: "provider_call", status: "cache_hit" }, `${providerId} cache hit`);
      return cached;
    }
  }

  if (!circuitBreaker.canAttempt(providerId)) {
    const circuitState = circuitBreaker.getState(providerId);
    persistHealthSnapshot(
      providerHealthStore.record(providerId, { type: "skipped", circuitState }),
    );
    log.warn(
      { event: "provider_call", status: "circuit_open", circuitState },
      `${providerId} skipped: circuit open`,
    );
    throw new ProviderSkippedError(providerId, "circuit_open");
  }

  let lastError: unknown;
  let lastWasTimeout = false;
  let rateLimitRemaining: number | null = null;
  const reportRateLimit = (remaining: number) => {
    rateLimitRemaining = remaining;
  };

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const start = Date.now();

    try {
      const result = await fn({ signal: controller.signal, reportRateLimit });
      clearTimeout(timer);
      const latencyMs = Date.now() - start;

      circuitBreaker.recordSuccess(providerId);
      const circuitState = circuitBreaker.getState(providerId);
      persistHealthSnapshot(
        providerHealthStore.record(providerId, {
          type: "success",
          latencyMs,
          circuitState,
          rateLimitRemaining,
        }),
      );
      log.info(
        {
          event: "provider_call",
          status: "success",
          latencyMs,
          attempt,
          circuitState,
          rateLimitRemaining,
        },
        `${providerId} search succeeded`,
      );

      if (opts.cacheKey) {
        cache.set(opts.cacheKey, result, opts.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS);
      }
      return result;
    } catch (err) {
      clearTimeout(timer);
      lastError = err;
      const latencyMs = Date.now() - start;
      const isTimeout = controller.signal.aborted;
      lastWasTimeout = isTimeout;
      const errorMessage = isTimeout
        ? `timed out after ${timeoutMs}ms`
        : err instanceof Error
          ? err.message
          : String(err);

      if (attempt < maxRetries) {
        log.warn(
          { event: "provider_call", status: "retry", latencyMs, attempt, errorMessage },
          `${providerId} search failed, retrying`,
        );
        await sleep(backoffDelay(attempt));
        continue;
      }

      circuitBreaker.recordFailure(providerId);
      const circuitState = circuitBreaker.getState(providerId);
      const consecutiveFailures = circuitBreaker.getConsecutiveFailures(providerId);
      persistHealthSnapshot(
        providerHealthStore.record(providerId, {
          type: "error",
          latencyMs,
          circuitState,
          consecutiveFailures,
          error: errorMessage,
        }),
      );
      log.error(
        {
          event: "provider_call",
          status: isTimeout ? "timeout" : "error",
          latencyMs,
          attempt,
          circuitState,
          errorMessage,
        },
        `${providerId} search failed`,
      );
    }
  }

  if (lastWasTimeout) {
    throw new ProviderTimeoutError(providerId, timeoutMs);
  }
  throw lastError;
}
