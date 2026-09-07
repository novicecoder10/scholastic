import { and, desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { creditBalance, creditLedger } from "@/lib/db/schema";
import { logger } from "@/lib/log/logger";

export type CreditReason =
  | "welcome_grant"
  | "periodic_replenishment"
  | "publication_verified"
  | "peer_review_verified"
  | "spend"
  | "refund"
  | "operator_adjustment";

export interface LedgerEntry {
  id: number;
  delta: number;
  reason: CreditReason;
  detail: unknown;
  balanceAfter: number;
  createdAt: Date;
}

export interface PostOptions {
  /** Present on grants, absent on spends. A repeat post under the same key is
   * a no-op that returns the balance unchanged. */
  idempotencyKey?: string;
  detail?: Record<string, unknown>;
}

/** SQLSTATE 23505 — the same cause-walking the library repository needs, for
 * the same reason: drizzle wraps the driver error in a message that carries
 * neither the code nor the constraint name. */
function isUniqueViolation(err: unknown): boolean {
  let current: unknown = err;
  for (let depth = 0; current && depth < 5; depth++) {
    if (typeof current === "object" && "code" in current && current.code === "23505") return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

export async function getBalance(userId: string): Promise<number> {
  const [row] = await getDb()
    .select({ balance: creditBalance.balance })
    .from(creditBalance)
    .where(eq(creditBalance.userId, userId))
    .limit(1);
  return row?.balance ?? 0;
}

/**
 * Appends one ledger row and moves the balance, in a single transaction.
 *
 * The ledger is the source of truth and `credit_balance` is a materialized
 * convenience; they are written together so the two can never disagree. The
 * balance is read `FOR UPDATE` inside the transaction, so two concurrent spends
 * serialise instead of both reading the same starting figure.
 *
 * Returns the new balance, or the existing one when an idempotency key has
 * already been used.
 */
export async function post(
  userId: string,
  delta: number,
  reason: CreditReason,
  options: PostOptions = {},
): Promise<number> {
  const db = getDb();
  try {
    return await db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ balance: creditBalance.balance })
        .from(creditBalance)
        .where(eq(creditBalance.userId, userId))
        .for("update")
        .limit(1);

      const before = existing?.balance ?? 0;
      // Clamped at zero: a balance below zero is not a debt anyone can be asked
      // to settle in a system with no way to buy credits, and a negative number
      // on /credits reads as a penalty rather than an empty allowance.
      const after = Math.max(0, before + delta);

      // The row records what actually moved, not what was asked for, so
      // `sum(delta)` equals the balance exactly and reconciliation needs no
      // special case. When a clamp swallowed part of a spend, the amount that
      // was intended is kept in `detail` rather than lost.
      const applied = after - before;
      const detail =
        applied === delta
          ? (options.detail ?? null)
          : { ...(options.detail ?? {}), requested: delta };

      await tx.insert(creditLedger).values({
        userId,
        delta: applied,
        reason,
        detail,
        balanceAfter: after,
        idempotencyKey: options.idempotencyKey ?? null,
      });

      if (existing) {
        await tx
          .update(creditBalance)
          .set({ balance: after, updatedAt: new Date() })
          .where(eq(creditBalance.userId, userId));
      } else {
        await tx.insert(creditBalance).values({ userId, balance: after, updatedAt: new Date() });
      }

      return after;
    });
  } catch (err) {
    // A duplicate idempotency key means the grant already happened. That is the
    // mechanism working, not a failure, so it returns the balance rather than
    // throwing at a caller who would have to special-case it anyway.
    if (options.idempotencyKey && isUniqueViolation(err)) {
      logger.info(
        { event: "credit_grant_already_applied", reason, idempotencyKey: options.idempotencyKey },
        "credit grant skipped: already applied",
      );
      return getBalance(userId);
    }
    throw err;
  }
}

export async function history(userId: string, limit = 50): Promise<LedgerEntry[]> {
  const rows = await getDb()
    .select()
    .from(creditLedger)
    .where(eq(creditLedger.userId, userId))
    .orderBy(desc(creditLedger.createdAt), desc(creditLedger.id))
    .limit(limit);
  return rows.map((r) => ({
    id: r.id,
    delta: r.delta,
    reason: r.reason as CreditReason,
    detail: r.detail,
    balanceAfter: r.balanceAfter,
    createdAt: r.createdAt,
  }));
}

export async function hasGrant(userId: string, idempotencyKey: string): Promise<boolean> {
  const [row] = await getDb()
    .select({ id: creditLedger.id })
    .from(creditLedger)
    .where(and(eq(creditLedger.userId, userId), eq(creditLedger.idempotencyKey, idempotencyKey)))
    .limit(1);
  return Boolean(row);
}

/**
 * `sum(delta)` against the stored balance. Exercised in tests and available as
 * a maintenance query — the ledger being canonical is only useful if drift is
 * detectable.
 *
 * Every row stores the delta that was actually applied, so the sum must equal
 * the balance exactly — any difference is real drift, not an artifact of a
 * clamped spend.
 */
export async function reconcile(
  userId: string,
): Promise<{ ledgerTotal: number; balance: number; consistent: boolean }> {
  const [row] = await getDb()
    .select({ total: sql<number>`coalesce(sum(${creditLedger.delta}), 0)::int` })
    .from(creditLedger)
    .where(eq(creditLedger.userId, userId));
  const balance = await getBalance(userId);
  const ledgerTotal = row?.total ?? 0;
  return { ledgerTotal, balance, consistent: ledgerTotal === balance };
}
