import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { withResilience } from "@/lib/resilience/withResilience";
import { ProviderSkippedError, ProviderTimeoutError } from "@/lib/providers/types";
import { circuitBreaker } from "@/lib/resilience/circuitBreaker";

// Each test uses a unique provider id / cache key to avoid cross-test interference
// with the shared circuit breaker and cache singletons.
let counter = 0;
function uniqueId(prefix: string) {
  counter += 1;
  return `${prefix}-${counter}`;
}

describe("withResilience", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the result on a successful call with no retries", async () => {
    const providerId = uniqueId("provider");
    const fn = vi.fn().mockResolvedValue({ works: [] });

    const result = await withResilience(providerId, fn);

    expect(result).toEqual({ works: [] });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on failure and succeeds within the retry budget", async () => {
    const providerId = uniqueId("provider");
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({ works: ["ok"] });

    const promise = withResilience(providerId, fn, { maxRetries: 2 });
    await vi.advanceTimersByTimeAsync(3000);
    const result = await promise;

    expect(result).toEqual({ works: ["ok"] });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("throws after exhausting all retries", async () => {
    const providerId = uniqueId("provider");
    const fn = vi.fn().mockRejectedValue(new Error("always fails"));

    const promise = withResilience(providerId, fn, { maxRetries: 2 });
    promise.catch(() => {}); // avoid unhandled rejection warning while timers advance
    await vi.advanceTimersByTimeAsync(10_000);

    await expect(promise).rejects.toThrow("always fails");
    expect(fn).toHaveBeenCalledTimes(3); // initial attempt + 2 retries
  });

  it("times out a call that respects the abort signal, like fetch does", async () => {
    const providerId = uniqueId("provider");
    // Mirrors how `fetch` behaves: rejects once its AbortSignal fires, rather than
    // hanging forever. withResilience relies on wrapped calls honoring the signal.
    const fn = vi.fn(
      ({ signal }: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("The operation was aborted")));
        }),
    );

    const promise = withResilience(providerId, fn, { timeoutMs: 100, maxRetries: 0 });
    promise.catch(() => {});
    await vi.advanceTimersByTimeAsync(200);

    await expect(promise).rejects.toBeInstanceOf(ProviderTimeoutError);
    await expect(promise).rejects.toThrow("timed out after 100ms");
  });

  it("skips the call immediately once the circuit is open", async () => {
    const providerId = uniqueId("provider");
    for (let i = 0; i < 5; i++) circuitBreaker.recordFailure(providerId);
    expect(circuitBreaker.getState(providerId)).toBe("open");

    const fn = vi.fn().mockResolvedValue({ works: [] });
    await expect(withResilience(providerId, fn)).rejects.toBeInstanceOf(ProviderSkippedError);
    expect(fn).not.toHaveBeenCalled();
  });

  it("returns a cached result without invoking the wrapped function again", async () => {
    const providerId = uniqueId("provider");
    const cacheKey = uniqueId("cache-key");
    const fn = vi.fn().mockResolvedValue({ works: ["first"] });

    const first = await withResilience(providerId, fn, { cacheKey, cacheTtlMs: 60_000 });
    const second = await withResilience(providerId, fn, { cacheKey, cacheTtlMs: 60_000 });

    expect(first).toEqual({ works: ["first"] });
    expect(second).toEqual({ works: ["first"] });
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
