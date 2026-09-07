import type { ProviderHealth } from "@/lib/providers/types";
import type { CircuitState } from "@/lib/resilience/circuitBreaker";

const RECENT_LATENCIES_SIZE = 20;

export interface ProviderHealthRecord {
  providerId: string;
  health: ProviderHealth;
  circuitState: CircuitState;
  consecutiveFailures: number;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
  recentLatenciesMs: number[];
  rateLimitRemaining: number | null;
}

function freshRecord(providerId: string): ProviderHealthRecord {
  return {
    providerId,
    health: "up",
    circuitState: "closed",
    consecutiveFailures: 0,
    lastSuccessAt: null,
    lastErrorAt: null,
    lastError: null,
    recentLatenciesMs: [],
    rateLimitRemaining: null,
  };
}

export type HealthEvent =
  | {
      type: "success";
      latencyMs: number;
      circuitState: CircuitState;
      rateLimitRemaining?: number | null;
    }
  | {
      type: "error";
      latencyMs: number;
      circuitState: CircuitState;
      consecutiveFailures: number;
      error: string;
    }
  | { type: "skipped"; circuitState: CircuitState }
  | { type: "disabled" };

class ProviderHealthStore {
  private records = new Map<string, ProviderHealthRecord>();

  record(providerId: string, event: HealthEvent): ProviderHealthRecord {
    const record = this.records.get(providerId) ?? freshRecord(providerId);

    switch (event.type) {
      case "success": {
        record.lastSuccessAt = new Date().toISOString();
        record.consecutiveFailures = 0;
        record.circuitState = event.circuitState;
        record.recentLatenciesMs.push(event.latencyMs);
        if (record.recentLatenciesMs.length > RECENT_LATENCIES_SIZE) {
          record.recentLatenciesMs.shift();
        }
        if (event.rateLimitRemaining !== undefined) {
          record.rateLimitRemaining = event.rateLimitRemaining;
        }
        record.health = "up";
        break;
      }
      case "error": {
        record.lastErrorAt = new Date().toISOString();
        record.lastError = event.error;
        record.consecutiveFailures = event.consecutiveFailures;
        record.circuitState = event.circuitState;
        record.recentLatenciesMs.push(event.latencyMs);
        if (record.recentLatenciesMs.length > RECENT_LATENCIES_SIZE) {
          record.recentLatenciesMs.shift();
        }
        record.health = event.circuitState === "open" ? "down" : "degraded";
        break;
      }
      case "skipped": {
        record.circuitState = event.circuitState;
        record.health = "down";
        break;
      }
      case "disabled": {
        record.health = "disabled";
        break;
      }
    }

    this.records.set(providerId, record);
    return record;
  }

  get(providerId: string): ProviderHealthRecord | undefined {
    return this.records.get(providerId);
  }

  getAll(): ProviderHealthRecord[] {
    return Array.from(this.records.values());
  }
}

/** Module-level singleton: health state is observed process-wide via /api/health/providers. */
export const providerHealthStore = new ProviderHealthStore();
