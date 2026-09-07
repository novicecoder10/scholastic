import { getDb } from "@/lib/db/client";
import { providerHealthSnapshot } from "@/lib/db/schema";
import type { ProviderHealthRecord } from "@/lib/resilience/healthStore";
import { logger } from "@/lib/log/logger";

function average(numbers: number[]): number | null {
  if (numbers.length === 0) return null;
  return numbers.reduce((sum, n) => sum + n, 0) / numbers.length;
}

/**
 * Fire-and-forget: a snapshot write failing (e.g. DB unreachable, or no
 * DATABASE_URL configured at all, as in unit tests) must never affect the
 * search request that triggered it. The in-memory health store is always the
 * authoritative live state; this table is only a durable, graphable trail.
 */
export function persistHealthSnapshot(record: ProviderHealthRecord): void {
  try {
    getDb()
      .insert(providerHealthSnapshot)
      .values({
        providerId: record.providerId,
        health: record.health,
        circuitState: record.circuitState,
        consecutiveFailures: record.consecutiveFailures,
        avgLatencyMs: average(record.recentLatenciesMs),
        rateLimitRemaining: record.rateLimitRemaining,
      })
      .catch((err: unknown) => {
        logger.warn(
          {
            event: "health_snapshot_persist_failed",
            providerId: record.providerId,
            err: String(err),
          },
          "failed to persist provider health snapshot",
        );
      });
  } catch (err) {
    // getDb() throws synchronously when DATABASE_URL is unset (e.g. unit tests).
    logger.warn(
      { event: "health_snapshot_persist_failed", providerId: record.providerId, err: String(err) },
      "failed to persist provider health snapshot",
    );
  }
}
