import { gte, count, avg, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { providerHealthSnapshot } from "@/lib/db/schema";

export interface HealthHistoryBucket {
  providerId: string;
  bucketStart: string;
  snapshotCount: number;
  uptimePercent: number;
  /**
   * Trend of the *average* latency recorded per snapshot — see the doc
   * comment below for why this can never be a true percentile.
   */
  avgLatencyMs: number | null;
  downCount: number;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Time-bucketed (hourly) health trend per provider, computed SQL-side rather
 * than pulling every row into JS — a snapshot is written on every single
 * provider call (see persistHealthSnapshot.ts), so this table can grow large.
 *
 * Honest constraint: `provider_health_snapshot.avg_latency_ms` stores only a
 * rolling *average* of the in-memory store's last-20-call window at the
 * moment each snapshot was written, never raw per-call samples. Averaging
 * that average across a bucket produces a reasonable latency *trend*, but
 * never a true p50/p95 — a real percentile view would need a schema change
 * (storing raw per-call samples), which is out of scope here. Don't rename
 * this field to anything implying percentiles.
 *
 * Callers should catch DB errors and degrade to an empty history — this is a
 * secondary ops view, not core functionality, so it follows the "never hard
 * fail" pattern used throughout this app, but the degrade decision is made by
 * the caller (the route) rather than swallowed here, since a caller like a
 * future CLI/report tool may want to know the query itself failed.
 */
export async function getProviderHealthHistory(sinceDays = 7): Promise<HealthHistoryBucket[]> {
  const db = getDb();
  const since = new Date(Date.now() - sinceDays * MS_PER_DAY);
  const bucket = sql<string>`date_trunc('hour', ${providerHealthSnapshot.recordedAt})`;

  const rows = await db
    .select({
      providerId: providerHealthSnapshot.providerId,
      bucketStart: bucket.as("bucket_start"),
      snapshotCount: count().as("snapshot_count"),
      upCount: count(sql`case when ${providerHealthSnapshot.health} = 'up' then 1 end`).as(
        "up_count",
      ),
      downCount: count(sql`case when ${providerHealthSnapshot.health} = 'down' then 1 end`).as(
        "down_count",
      ),
      avgLatencyMs: avg(providerHealthSnapshot.avgLatencyMs).as("avg_latency_ms"),
    })
    .from(providerHealthSnapshot)
    .where(gte(providerHealthSnapshot.recordedAt, since))
    .groupBy(providerHealthSnapshot.providerId, bucket)
    .orderBy(providerHealthSnapshot.providerId, bucket);

  return rows.map((row) => {
    const snapshotCount = Number(row.snapshotCount);
    const upCount = Number(row.upCount);
    return {
      providerId: row.providerId,
      bucketStart: String(row.bucketStart),
      snapshotCount,
      uptimePercent: snapshotCount > 0 ? (upCount / snapshotCount) * 100 : 0,
      avgLatencyMs: row.avgLatencyMs != null ? Number(row.avgLatencyMs) : null,
      downCount: Number(row.downCount),
    };
  });
}
