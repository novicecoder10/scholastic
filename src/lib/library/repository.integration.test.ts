import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { config } from "dotenv";
import { sql } from "drizzle-orm";

config({ path: ".env.local", quiet: true });

/**
 * Runs against the real database, because everything worth proving here is a
 * database guarantee: the CHECK constraint on `saved_item`, the partial unique
 * indexes that make saving idempotent, and — the reason this file exists — that
 * one user's queries cannot reach another user's rows.
 *
 * A unit test with a mocked `getDb()` can only prove that the code passes a
 * userId to a WHERE clause. It cannot prove the WHERE clause works.
 *
 * Skipped when DATABASE_URL is unset, so `pnpm test` stays green on a checkout
 * with no Postgres. Same precedent as pdf/extract.integration.test.ts, which
 * exercises the real pdfjs rather than a mock.
 */
const hasDatabase = Boolean(process.env.DATABASE_URL);
const describeDb = hasDatabase ? describe : describe.skip;

const USER_A = "itest-user-a";
const USER_B = "itest-user-b";

describeDb("library repository against a real database", () => {
  let db: ReturnType<typeof import("@/lib/db/client").getDb>;
  let repo: typeof import("@/lib/library/repository");

  beforeAll(async () => {
    db = (await import("@/lib/db/client")).getDb();
    repo = await import("@/lib/library/repository");

    for (const id of [USER_A, USER_B]) {
      await db.execute(
        sql`INSERT INTO "user" (id, name, email) VALUES (${id}, ${id}, ${`${id}@example.test`})
            ON CONFLICT (id) DO NOTHING`,
      );
    }
  });

  afterAll(async () => {
    if (!hasDatabase) return;
    await db.execute(sql`DELETE FROM "user" WHERE id IN (${USER_A}, ${USER_B})`);
  });

  function work(workKey: string, title = "A Paper") {
    return {
      id: workKey,
      workKey,
      doi: null,
      title,
      abstract: null,
      authors: [{ name: "Jane Smith" }],
      year: 2020,
      venue: "Nature",
      citationCount: 1,
      isOpenAccess: false,
      pdfUrl: null,
      landingPageUrl: null,
      sources: [],
      bibliographic: null,
      topics: [],
      score: 0,
    };
  }

  it("saves a paper and lists it back with its snapshot", async () => {
    await repo.saveWork(USER_A, work("k1", "Original title"));
    const items = await repo.listSavedItems(USER_A, "work");
    expect(items.map((i) => i.workKey)).toContain("k1");
    expect(items.find((i) => i.workKey === "k1")?.workSnapshot?.title).toBe("Original title");
  });

  it("is idempotent — saving twice updates rather than erroring", async () => {
    await repo.saveWork(USER_A, work("k2", "First"));
    await repo.saveWork(USER_A, work("k2", "Second"));
    const items = await repo.listSavedItems(USER_A, "work");
    expect(items.filter((i) => i.workKey === "k2")).toHaveLength(1);
    expect(items.find((i) => i.workKey === "k2")?.workSnapshot?.title).toBe("Second");
  });

  it("keeps the snapshot the user saw, not whatever the live work row says", async () => {
    await repo.saveWork(USER_A, work("k3", "As saved"));
    // persistWorks writes to `work` best-effort and un-awaited, so the live row
    // may be stale or absent. The library must not depend on it.
    await db.execute(sql`DELETE FROM "work" WHERE work_key = 'k3'`);
    const items = await repo.listSavedItems(USER_A, "work");
    expect(items.find((i) => i.workKey === "k3")?.workSnapshot?.title).toBe("As saved");
  });

  it("does not let one user see another's saved items", async () => {
    await repo.saveWork(USER_A, work("k4"));
    expect((await repo.listSavedItems(USER_B, "work")).map((i) => i.workKey)).not.toContain("k4");
  });

  it("does not let one user unsave another's item", async () => {
    const saved = await repo.saveWork(USER_A, work("k5"));
    expect(await repo.unsave(USER_B, saved.id)).toBe(false);
    expect((await repo.listSavedItems(USER_A, "work")).map((i) => i.workKey)).toContain("k5");
  });

  it("rejects a malformed row at the database level", async () => {
    // The CHECK constraint, not application code, is what keeps the
    // polymorphism honest.
    await expect(
      db.execute(
        sql`INSERT INTO saved_item (user_id, item_type, work_key, document_id)
            VALUES (${USER_A}, 'work', 'k6', 'doc-1')`,
      ),
    ).rejects.toThrow();

    await expect(
      db.execute(
        sql`INSERT INTO saved_item (user_id, item_type, work_key, document_id)
            VALUES (${USER_A}, 'work', NULL, NULL)`,
      ),
    ).rejects.toThrow();
  });

  it("reports which of a list of workKeys are saved", async () => {
    await repo.saveWork(USER_A, work("k7"));
    const saved = await repo.savedWorkKeys(USER_A, ["k7", "never-saved"]);
    expect(saved.has("k7")).toBe(true);
    expect(saved.has("never-saved")).toBe(false);
  });

  it("survives a workKey containing a quote", async () => {
    // savedWorkKeys once built an ARRAY[...] literal by hand; this is the input
    // that would have broken it.
    const nasty = "doi:10.1/o'brien";
    await repo.saveWork(USER_A, work(nasty));
    expect((await repo.savedWorkKeys(USER_A, [nasty])).has(nasty)).toBe(true);
  });

  describe("collections", () => {
    it("rejects a duplicate name for the same user but allows it across users", async () => {
      await repo.createCollection(USER_A, "Thesis");
      await expect(repo.createCollection(USER_A, "Thesis")).rejects.toThrow(
        repo.DuplicateCollectionNameError,
      );
      await expect(repo.createCollection(USER_B, "Thesis")).resolves.toBeTruthy();
    });

    it("returns nothing for another user's collection rather than erroring", async () => {
      const mine = await repo.createCollection(USER_A, "Private notes");
      expect(await repo.findCollection(USER_B, mine.publicId)).toBeNull();
      expect(await repo.deleteCollection(USER_B, mine.publicId)).toBe(false);
      expect(await repo.findCollection(USER_A, mine.publicId)).not.toBeNull();
    });

    it("refuses to add another user's saved item to your collection", async () => {
      const theirs = await repo.saveWork(USER_B, work("k8"));
      const mine = await repo.createCollection(USER_A, "Mixed");
      // Checking only the collection's owner would let A pull B's item in and
      // read its snapshot.
      expect(await repo.addToCollection(USER_A, mine.publicId, theirs.id)).toBe(false);
      expect(await repo.listCollectionItems(mine.id)).toHaveLength(0);
    });

    it("adds, orders, reorders and removes", async () => {
      const target = await repo.createCollection(USER_A, "Ordered");
      const first = await repo.saveWork(USER_A, work("o1"));
      const second = await repo.saveWork(USER_A, work("o2"));
      const third = await repo.saveWork(USER_A, work("o3"));

      for (const item of [first, second, third]) {
        expect(await repo.addToCollection(USER_A, target.publicId, item.id)).toBe(true);
      }
      expect((await repo.listCollectionItems(target.id)).map((i) => i.workKey)).toEqual([
        "o1",
        "o2",
        "o3",
      ]);

      await repo.reorderCollection(USER_A, target.publicId, [third.id, first.id, second.id]);
      expect((await repo.listCollectionItems(target.id)).map((i) => i.workKey)).toEqual([
        "o3",
        "o1",
        "o2",
      ]);

      expect(await repo.removeFromCollection(USER_A, target.publicId, first.id)).toBe(true);
      expect((await repo.listCollectionItems(target.id)).map((i) => i.workKey)).toEqual([
        "o3",
        "o2",
      ]);
    });

    it("adding the same item twice is a no-op, not a duplicate row", async () => {
      const target = await repo.createCollection(USER_A, "Dupes");
      const item = await repo.saveWork(USER_A, work("d1"));
      await repo.addToCollection(USER_A, target.publicId, item.id);
      await repo.addToCollection(USER_A, target.publicId, item.id);
      expect(await repo.listCollectionItems(target.id)).toHaveLength(1);
    });

    it("ignores a reorder naming items that are not in the collection", async () => {
      const target = await repo.createCollection(USER_A, "Reorder guard");
      const inside = await repo.saveWork(USER_A, work("r1"));
      const outside = await repo.saveWork(USER_A, work("r2"));
      await repo.addToCollection(USER_A, target.publicId, inside.id);

      await repo.reorderCollection(USER_A, target.publicId, [outside.id, inside.id]);
      // A reorder is about order. Letting it also add members would make a
      // retried request produce a different collection than the user saw.
      expect((await repo.listCollectionItems(target.id)).map((i) => i.workKey)).toEqual(["r1"]);
    });

    it("cascades: deleting a user removes their collections and saved items", async () => {
      await repo.saveWork(USER_B, work("cascade-1"));
      await repo.createCollection(USER_B, "Doomed");
      await db.execute(sql`DELETE FROM "user" WHERE id = ${USER_B}`);
      expect(await repo.listSavedItems(USER_B)).toHaveLength(0);
      expect(await repo.listCollections(USER_B)).toHaveLength(0);
      await db.execute(
        sql`INSERT INTO "user" (id, name, email) VALUES (${USER_B}, ${USER_B}, ${`${USER_B}@example.test`})`,
      );
    });
  });
});
