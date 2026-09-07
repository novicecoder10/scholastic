import type { ProviderHealthSummaryEntry } from "@/lib/resilience/providerHealthSummary";
import type { HealthHistoryBucket } from "@/lib/resilience/healthHistory";

const HEALTH_COLORS: Record<string, string> = {
  up: "border border-success/40 text-success",
  degraded: "border border-warning-line text-warning-ink",
  down: "border border-danger/40 text-danger",
  disabled: "border border-line text-muted",
};

const SPARKLINE_WIDTH = 160;
const SPARKLINE_HEIGHT = 32;

/** Dependency-free SVG sparkline — no charting library exists in this app, and adding one for a
 * single trend line would be disproportionate. */
function LatencySparkline({ buckets }: { buckets: HealthHistoryBucket[] }) {
  const points = buckets.filter((b) => b.avgLatencyMs != null);
  if (points.length < 2) {
    return <p className="text-muted text-xs">Not enough history yet for a trend line.</p>;
  }

  const latencies = points.map((b) => b.avgLatencyMs as number);
  const max = Math.max(...latencies, 1);
  const min = Math.min(...latencies, 0);
  const range = max - min || 1;

  const coords = points.map((b, i) => {
    const x = (i / (points.length - 1)) * SPARKLINE_WIDTH;
    const y = SPARKLINE_HEIGHT - (((b.avgLatencyMs as number) - min) / range) * SPARKLINE_HEIGHT;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  return (
    <svg
      viewBox={`0 0 ${SPARKLINE_WIDTH} ${SPARKLINE_HEIGHT}`}
      width={SPARKLINE_WIDTH}
      height={SPARKLINE_HEIGHT}
      role="img"
      aria-label={`Average latency trend, ${Math.round(min)}ms to ${Math.round(max)}ms`}
      className="text-accent"
    >
      <polyline points={coords.join(" ")} fill="none" stroke="currentColor" strokeWidth={1.5} />
    </svg>
  );
}

export function ProviderHealthDashboard({
  summary,
  history,
}: {
  summary: ProviderHealthSummaryEntry[];
  history: HealthHistoryBucket[];
}) {
  const historyByProvider = new Map<string, HealthHistoryBucket[]>();
  for (const bucket of history) {
    const existing = historyByProvider.get(bucket.providerId) ?? [];
    existing.push(bucket);
    historyByProvider.set(bucket.providerId, existing);
  }

  return (
    <div className="flex flex-col gap-4">
      {history.length === 0 && (
        <p className="text-muted text-sm">
          No historical trend data yet — this fills in as the app handles more requests.
        </p>
      )}
      {summary.map((provider) => {
        const buckets = historyByProvider.get(provider.id) ?? [];
        const totalSnapshots = buckets.reduce((sum, b) => sum + b.snapshotCount, 0);
        const totalDown = buckets.reduce((sum, b) => sum + b.downCount, 0);
        const overallUptimePercent =
          totalSnapshots > 0 ? ((totalSnapshots - totalDown) / totalSnapshots) * 100 : null;

        return (
          <div
            key={provider.id}
            className="border-line bg-surface flex flex-col gap-2 rounded-xl border p-4 sm:flex-row sm:items-center sm:justify-between"
          >
            <div>
              <div className="flex items-center gap-2">
                <span className="font-medium">{provider.displayName}</span>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${HEALTH_COLORS[provider.health] ?? HEALTH_COLORS.disabled}`}
                >
                  {provider.health}
                </span>
              </div>
              <p className="text-muted mt-1 text-xs">
                {provider.avgLatencyMs != null
                  ? `${Math.round(provider.avgLatencyMs)}ms avg latency now`
                  : "no recent calls"}
                {overallUptimePercent != null &&
                  ` · ${overallUptimePercent.toFixed(1)}% uptime (last 7 days)`}
              </p>
            </div>
            <LatencySparkline buckets={buckets} />
          </div>
        );
      })}
    </div>
  );
}
