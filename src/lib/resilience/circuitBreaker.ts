export type CircuitState = "closed" | "open" | "half_open";

const CONSECUTIVE_FAILURE_THRESHOLD = 5;
const ROLLING_WINDOW_SIZE = 10;
const ROLLING_FAILURE_RATE_THRESHOLD = 0.8;
const INITIAL_COOLDOWN_MS = 30_000;
const MAX_COOLDOWN_MS = 5 * 60_000;

interface BreakerRecord {
  state: CircuitState;
  consecutiveFailures: number;
  /** true/false outcomes of the last ROLLING_WINDOW_SIZE calls while closed, oldest first. */
  rollingResults: boolean[];
  cooldownMs: number;
  openedAt: number | null;
  /** Guards against more than one concurrent trial call while half-open. */
  halfOpenTrialInFlight: boolean;
}

function freshRecord(): BreakerRecord {
  return {
    state: "closed",
    consecutiveFailures: 0,
    rollingResults: [],
    cooldownMs: INITIAL_COOLDOWN_MS,
    openedAt: null,
    halfOpenTrialInFlight: false,
  };
}

export class CircuitBreaker {
  private records = new Map<string, BreakerRecord>();

  private recordFor(providerId: string): BreakerRecord {
    let record = this.records.get(providerId);
    if (!record) {
      record = freshRecord();
      this.records.set(providerId, record);
    }
    return record;
  }

  /**
   * Call before attempting a provider request. Returns whether the call may proceed,
   * transitioning open -> half_open as a side effect once the cooldown has elapsed.
   */
  canAttempt(providerId: string, now = Date.now()): boolean {
    const record = this.recordFor(providerId);

    if (record.state === "closed") return true;

    if (record.state === "open") {
      const openedAt = record.openedAt ?? now;
      if (now - openedAt >= record.cooldownMs) {
        record.state = "half_open";
        record.halfOpenTrialInFlight = true;
        return true;
      }
      return false;
    }

    // half_open: only the one in-flight trial call is allowed through.
    return false;
  }

  recordSuccess(providerId: string): void {
    const record = this.recordFor(providerId);
    if (record.state === "half_open") {
      this.records.set(providerId, freshRecord());
      return;
    }
    record.consecutiveFailures = 0;
    record.rollingResults.push(true);
    if (record.rollingResults.length > ROLLING_WINDOW_SIZE) record.rollingResults.shift();
  }

  recordFailure(providerId: string, now = Date.now()): void {
    const record = this.recordFor(providerId);

    if (record.state === "half_open") {
      record.state = "open";
      record.halfOpenTrialInFlight = false;
      record.openedAt = now;
      record.cooldownMs = Math.min(record.cooldownMs * 2, MAX_COOLDOWN_MS);
      return;
    }

    record.consecutiveFailures += 1;
    record.rollingResults.push(false);
    if (record.rollingResults.length > ROLLING_WINDOW_SIZE) record.rollingResults.shift();

    const failureRate =
      record.rollingResults.length > 0
        ? record.rollingResults.filter((r) => !r).length / record.rollingResults.length
        : 0;

    const shouldTrip =
      record.consecutiveFailures >= CONSECUTIVE_FAILURE_THRESHOLD ||
      (record.rollingResults.length >= ROLLING_WINDOW_SIZE &&
        failureRate >= ROLLING_FAILURE_RATE_THRESHOLD);

    if (shouldTrip) {
      record.state = "open";
      record.openedAt = now;
    }
  }

  getState(providerId: string): CircuitState {
    return this.recordFor(providerId).state;
  }

  getConsecutiveFailures(providerId: string): number {
    return this.recordFor(providerId).consecutiveFailures;
  }

  reset(providerId: string): void {
    this.records.set(providerId, freshRecord());
  }
}

/** Module-level singleton: breaker state must be shared across all callers in the process. */
export const circuitBreaker = new CircuitBreaker();
