import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { config } from "dotenv";
import { sql } from "drizzle-orm";

config({ path: ".env.local", quiet: true });

/**
 * Against real Postgres, because the things worth proving are database
 * guarantees: the CHECK that stops a `found` cell existing without provenance,
 * the ownership predicate, and the counts on the index page — which were wrong
 * in a way no mocked `getDb()` could have shown.
 */
const hasDatabase = Boolean(process.env.DATABASE_URL);
const describeDb = hasDatabase ? describe : describe.skip;

const OWNER_A = { kind: "anonymous" as const, sessionId: "itest-matrix-a" };
const OWNER_B = { kind: "anonymous" as const, sessionId: "itest-matrix-b" };
const DOC = "itest-matrix-doc";

describeDb("matrix repository against a real database", () => {
  let db: ReturnType<typeof import("@/lib/db/client").getDb>;
  let repo: typeof import("@/lib/extraction/repository");

  beforeAll(async () => {
    db = (await import("@/lib/db/client")).getDb();
    repo = await import("@/lib/extraction/repository");
    await db.execute(
      sql`INSERT INTO "document" (document_id, owner_session_id, filename, storage_key, sha256, byte_size, status)
          VALUES (${DOC}, ${OWNER_A.sessionId}, 'paper.pdf', 'k', 's', 1, 'indexed')
          ON CONFLICT (document_id) DO NOTHING`,
    );
  });

  beforeEach(async () => {
    await db.execute(
      sql`DELETE FROM matrix WHERE owner_session_id IN (${OWNER_A.sessionId}, ${OWNER_B.sessionId})`,
    );
  });

  afterAll(async () => {
    if (!hasDatabase) return;
    await db.execute(
      sql`DELETE FROM matrix WHERE owner_session_id IN (${OWNER_A.sessionId}, ${OWNER_B.sessionId})`,
    );
    await db.execute(sql`DELETE FROM "document" WHERE document_id = ${DOC}`);
  });

  it("counts a new matrix as empty", async () => {
    // The bug this test exists for: a correlated subquery that never correlated
    // reported 2 papers and 2 fields for a matrix created seconds earlier.
    await repo.createMatrix(OWNER_A, "Fresh");
    const [listed] = await repo.listMatrices(OWNER_A);
    expect(listed.rowCount).toBe(0);
    expect(listed.columnCount).toBe(0);
  });

  it("counts rows and columns independently, not their product", async () => {
    const created = await repo.createMatrix(OWNER_A, "Counted");
    await repo.addColumn(created.id, "sample size", null, "number");
    await repo.addColumn(created.id, "design", null, "text");
    await repo.addColumn(created.id, "duration", null, "text");
    await repo.addRow(created.id, DOC);

    const [listed] = await repo.listMatrices(OWNER_A);
    expect(listed).toMatchObject({ rowCount: 1, columnCount: 3 });
  });

  it("hides one owner's matrix from another", async () => {
    const created = await repo.createMatrix(OWNER_A, "Private");
    expect(await repo.findMatrix(OWNER_B, created.publicId)).toBeNull();
    expect(await repo.listMatrices(OWNER_B)).toEqual([]);
  });

  it("adds a paper once, however many times it is added", async () => {
    const created = await repo.createMatrix(OWNER_A, "Idempotent");
    expect(await repo.addRow(created.id, DOC)).not.toBeNull();
    // Null, not a conflict: adding the same paper twice is a slip, not an error
    // worth a dialog.
    expect(await repo.addRow(created.id, DOC)).toBeNull();
    const [listed] = await repo.listMatrices(OWNER_A);
    expect(listed.rowCount).toBe(1);
  });

  it("refuses to store a found cell with no provenance", async () => {
    // The CHECK constraint is the last line of defence behind the guards: a
    // value with no page and no quote must not be storable at all.
    const created = await repo.createMatrix(OWNER_A, "Provenance");
    const column = await repo.addColumn(created.id, "sample size", null, "number");
    const row = await repo.addRow(created.id, DOC);
    await expect(
      repo.saveCell(created.id, row!.id, column.id, {
        status: "found",
        value: "412",
        unit: null,
        quote: null,
        pageNumber: null,
        error: null,
      }),
    ).rejects.toBeTruthy();
  });

  it("stores a fully provenanced cell, and overwrites it on a refill", async () => {
    const created = await repo.createMatrix(OWNER_A, "Refill");
    const column = await repo.addColumn(created.id, "sample size", null, "number");
    const row = await repo.addRow(created.id, DOC);
    const cell = {
      status: "found" as const,
      value: "412",
      unit: null,
      quote: "we recruited 412 participants",
      pageNumber: 3,
      error: null,
    };
    await repo.saveCell(created.id, row!.id, column.id, cell);
    await repo.saveCell(created.id, row!.id, column.id, { ...cell, value: "413" });

    const { cells } = await repo.matrixContents(created.id);
    expect(cells).toHaveLength(1);
    expect(cells[0].value).toBe("413");
  });

  it("stores not_reported without provenance, because there is none to have", async () => {
    const created = await repo.createMatrix(OWNER_A, "Absent");
    const column = await repo.addColumn(created.id, "effect size", null, "number");
    const row = await repo.addRow(created.id, DOC);
    await repo.saveCell(created.id, row!.id, column.id, {
      status: "not_reported",
      value: null,
      unit: null,
      quote: null,
      pageNumber: null,
      error: null,
    });
    const { cells } = await repo.matrixContents(created.id);
    expect(cells[0].status).toBe("not_reported");
  });

  it("adopts an anonymous matrix into an account only while it has no owner", async () => {
    await db.execute(
      sql`INSERT INTO "user" (id, name, email) VALUES ('itest-matrix-user', 'u', 'm@example.test')
          ON CONFLICT (id) DO NOTHING`,
    );
    await repo.createMatrix(OWNER_A, "Adoptable");
    expect(await repo.claimMatrices("itest-matrix-user", OWNER_A.sessionId)).toBe(1);
    // Second sign-in on the same browser claims nothing: the row now has a
    // user, and `user_id IS NULL` is what stops it moving again.
    expect(await repo.claimMatrices("itest-matrix-user", OWNER_A.sessionId)).toBe(0);

    await db.execute(sql`DELETE FROM matrix WHERE user_id = 'itest-matrix-user'`);
    await db.execute(sql`DELETE FROM "user" WHERE id = 'itest-matrix-user'`);
  });
});
