import { ALL_PROVIDERS } from "@/lib/providers/registry";
import { providerHealthStore } from "@/lib/resilience/healthStore";

export interface ProviderHealthSummaryEntry {
  id: string;
  displayName: string;
  requiresCredential: boolean;
  isEnabled: boolean;
  health: string;
  circuitState: string;
  consecutiveFailures: number;
  avgLatencyMs: number | null;
  rateLimitRemaining: number | null;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
}

/**
 * Current, in-memory state for every registered provider. Shared by
 * GET /api/health/providers and the /health dashboard page so there's exactly
 * one implementation of "what does current provider health look like" — the
 * dashboard additionally layers on historical trend data (healthHistory.ts),
 * which this in-memory store can't provide (it holds only the current record,
 * not a time series).
 */
export function getProviderHealthSummary(): ProviderHealthSummaryEntry[] {
  return ALL_PROVIDERS.map((provider) => {
    const isEnabled = provider.isConfigured();
    const record = providerHealthStore.get(provider.meta.id);

    return {
      id: provider.meta.id,
      displayName: provider.meta.displayName,
      requiresCredential: provider.meta.requiresCredential,
      isEnabled,
      health: record?.health ?? (isEnabled ? "up" : "disabled"),
      circuitState: record?.circuitState ?? "closed",
      consecutiveFailures: record?.consecutiveFailures ?? 0,
      avgLatencyMs:
        record && record.recentLatenciesMs.length > 0
          ? record.recentLatenciesMs.reduce((sum, n) => sum + n, 0) /
            record.recentLatenciesMs.length
          : null,
      rateLimitRemaining: record?.rateLimitRemaining ?? null,
      lastSuccessAt: record?.lastSuccessAt ?? null,
      lastErrorAt: record?.lastErrorAt ?? null,
      lastError: record?.lastError ?? null,
    };
  });
}
