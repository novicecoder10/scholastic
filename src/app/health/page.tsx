import type { Metadata } from "next";
import { getProviderHealthSummary } from "@/lib/resilience/providerHealthSummary";
import { getProviderHealthHistory, type HealthHistoryBucket } from "@/lib/resilience/healthHistory";
import { ProviderHealthDashboard } from "@/components/health/ProviderHealthDashboard";
import { logger } from "@/lib/log/logger";

export const metadata: Metadata = {
  title: "Provider health",
  description: "Live status and historical trend for every data source Scholastic aggregates.",
};

/**
 * The app's first secondary route — a server component calling the shared lib
 * functions directly (same pattern as the home page calling performSearch()
 * directly, rather than self-fetching its own API route over the network).
 * A DB failure here degrades to an empty history rather than a broken page,
 * same contract as the /api/health/providers/history route.
 */
export default async function HealthPage() {
  const summary = getProviderHealthSummary();

  let history: HealthHistoryBucket[] = [];
  try {
    history = await getProviderHealthHistory();
  } catch (err) {
    logger.warn(
      { event: "health_page_history_query_failed", err: String(err) },
      "provider health history query failed",
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-10 sm:px-8">
      <div>
        <h1 className="text-ink text-2xl font-semibold tracking-tight sm:text-3xl">
          Provider health
        </h1>
        <p className="text-muted mt-1 text-sm">
          Live status and 7-day latency/uptime trend for every data source Scholastic aggregates.
        </p>
      </div>
      <ProviderHealthDashboard summary={summary} history={history} />
    </main>
  );
}
