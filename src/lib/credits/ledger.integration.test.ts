import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { config } from "dotenv";
import { sql } from "drizzle-orm";

config({ path: ".env.local", quiet: true });

/**
 * Against the real database, because every guarantee here is one Postgres
 * makes: the partial unique index that stops a grant running twice, the
 * transaction that keeps `credit_balance` in step with the ledger, and the
 * `sum(delta) == balance` invariant that makes the ledger canonical rather than
 * decorative.
 *
 * Mocking `getDb()` would only prove the code sends the statements it sends.
 * Skipped without DATABASE_URL, like the library and pdf integration suites.
 */
const hasDatabase = Boolean(process.env.DATABASE_URL);
const describeDb = hasDatabase ? describe : describe.skip;

const USER = "itest-credit-user";
const OTHER = "itest-credit-other";

describeDb("credit ledger against a real database", () => {
  let db: ReturnType<typeof import("@/lib/db/client").getDb>;
  let ledger: typeof import("@/lib/credits/ledger");
  let grants: typeof import("@/lib/credits/grants");

  beforeAll(async () => {
    db = (await import("@/lib/db/client")).getDb();
    ledger = await import("@/lib/credits/ledger");
    grants = await import("@/lib/credits/grants");
    for (const id of [USER, OTHER]) {
      await db.execute(
        sql`INSERT INTO "user" (id, name, email) VALUES (${id}, ${id}, ${`${id}@example.test`})
            ON CONFLICT (id) DO NOTHING`,
      );
    }
  });

  beforeEach(async () => {
    await db.execute(sql`DELETE FROM credit_ledger WHERE user_id IN (${USER}, ${OTHER})`);
    await db.execute(sql`DELETE FROM credit_balance WHERE user_id IN (${USER}, ${OTHER})`);
  });

  afterAll(async () => {
    if (!hasDatabase) return;
    await db.execute(sql`DELETE FROM "user" WHERE id IN (${USER}, ${OTHER})`);
  });

  it("starts at zero for a user with no history", async () => {
    expect(await ledger.getBalance(USER)).toBe(0);
  });

  it("keeps sum(delta) equal to the balance after an arbitrary sequence", async () => {
    await ledger.post(USER, 500, "welcome_grant", { idempotencyKey: "welcome" });
    await ledger.post(USER, -12, "spend", { detail: { feature: "summary" } });
    await ledger.post(USER, -40, "spend", { detail: { feature: "synthesis_turn" } });
    await ledger.post(USER, 25, "publication_verified", { idempotencyKey: "work:W1" });
    await ledger.post(USER, -3, "spend", { detail: { feature: "chat_turn" } });

    const check = await ledger.reconcile(USER);
    expect(check.balance).toBe(470);
    expect(check.consistent).toBe(true);
  });

  it("records every event, not just the net figure", async () => {
    await ledger.post(USER, 500, "welcome_grant", { idempotencyKey: "welcome" });
    await ledger.post(USER, -12, "spend", { detail: { feature: "summary" } });
    const rows = await ledger.history(USER);
    expect(rows).toHaveLength(2);
    // Newest first, and each row carries the balance it produced — the point of
    // an append-only ledger is being able to answer "why 488".
    expect(rows[0].balanceAfter).toBe(488);
    expect(rows[1].balanceAfter).toBe(500);
  });

  it("applies a keyed grant once, however many times it is posted", async () => {
    await ledger.post(USER, 500, "welcome_grant", { idempotencyKey: "welcome" });
    const second = await ledger.post(USER, 500, "welcome_grant", { idempotencyKey: "welcome" });
    expect(second).toBe(500);
    expect(await ledger.getBalance(USER)).toBe(500);
  });

  it("lets two users hold the same idempotency key", async () => {
    // The uniqueness is per user. A shared key namespace would mean the second
    // researcher to sign up never gets a welcome grant.
    await ledger.post(USER, 500, "welcome_grant", { idempotencyKey: "welcome" });
    await ledger.post(OTHER, 500, "welcome_grant", { idempotencyKey: "welcome" });
    expect(await ledger.getBalance(OTHER)).toBe(500);
  });

  it("does not deduplicate spends, which carry no key", async () => {
    await ledger.post(USER, 100, "operator_adjustment");
    await ledger.post(USER, -5, "spend", { detail: { feature: "summary" } });
    await ledger.post(USER, -5, "spend", { detail: { feature: "summary" } });
    expect(await ledger.getBalance(USER)).toBe(90);
  });

  it("clamps at zero and records what was actually taken", async () => {
    await ledger.post(USER, 3, "operator_adjustment");
    await ledger.post(USER, -10, "spend", { detail: { feature: "synthesis_turn" } });
    expect(await ledger.getBalance(USER)).toBe(0);

    const [latest] = await ledger.history(USER, 1);
    // The row stores the 3 that moved, with the 10 that was asked for kept in
    // detail — so reconciliation stays exact without losing the real cost.
    expect(latest.delta).toBe(-3);
    expect((latest.detail as { requested: number }).requested).toBe(-10);
    expect((await ledger.reconcile(USER)).consistent).toBe(true);
  });

  it("grants the welcome allowance exactly once per account", async () => {
    const first = await grants.grantWelcome(USER);
    const second = await grants.grantWelcome(USER);
    expect(second).toBe(first);
    expect(await ledger.hasGrant(USER, "welcome")).toBe(true);
  });

  it("tops the balance up to the monthly floor rather than adding to it", async () => {
    const floor = Number(process.env.CREDITS_MONTHLY_FLOOR ?? 300);
    await ledger.post(USER, 50, "operator_adjustment");
    expect(await grants.grantMonthlyReplenishment(USER)).toBe(floor);
  });

  it("is a no-op above the floor, and writes no '+0' row", async () => {
    const floor = Number(process.env.CREDITS_MONTHLY_FLOOR ?? 300);
    await ledger.post(USER, floor + 100, "operator_adjustment");
    expect(await grants.grantMonthlyReplenishment(USER)).toBe(floor + 100);
    expect(await ledger.history(USER)).toHaveLength(1);
  });

  it("replenishes once per calendar month", async () => {
    await grants.grantMonthlyReplenishment(USER);
    const balanceAfterFirst = await ledger.getBalance(USER);
    await ledger.post(USER, -100, "spend", { detail: { feature: "chat_turn" } });
    // A second run in the same month must not refill what was just spent.
    await grants.grantMonthlyReplenishment(USER);
    expect(await ledger.getBalance(USER)).toBe(balanceAfterFirst - 100);
  });

  it("grants for each contribution once, and nothing on a re-run", async () => {
    const contributions = [
      { id: "W1", kind: "publication" as const, title: "A paper", year: 2024 },
      { id: "W2", kind: "publication" as const, title: "Another paper", year: 2025 },
      { id: "PR1", kind: "peer_review" as const, title: "Peer review", year: 2025 },
    ];
    const first = await grants.grantForContributions(USER, contributions);
    expect(first.granted).toBe(3);
    expect(first.credits).toBeGreaterThan(0);

    const second = await grants.grantForContributions(USER, contributions);
    expect(second.granted).toBe(0);
    expect(second.alreadyCounted).toBe(3);
    expect(second.balance).toBe(first.balance);
  });

  it("grants only the new work when one paper is added", async () => {
    await grants.grantForContributions(USER, [
      { id: "W1", kind: "publication", title: "A paper", year: 2024 },
    ]);
    const run = await grants.grantForContributions(USER, [
      { id: "W1", kind: "publication", title: "A paper", year: 2024 },
      { id: "W2", kind: "publication", title: "A newer paper", year: 2026 },
    ]);
    expect(run.granted).toBe(1);
    expect(run.alreadyCounted).toBe(1);
  });
});
