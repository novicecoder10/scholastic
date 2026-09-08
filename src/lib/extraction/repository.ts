import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { getDb } from "@/lib/db/client";
import {
  extractedFinding,
  extractedTable,
  extraction,
  matrix,
  matrixCell,
  matrixColumn,
  matrixRow,
} from "@/lib/db/schema";
import type { Owner } from "@/lib/auth/owner";
import type { CellResult } from "@/lib/extraction/matrix";
import type { Finding, InterpretedTable } from "@/lib/extraction/extract";

/** Same shape and reasoning as #2's document ids: unguessable, so a matrix URL
 * is a capability and an unowned one answers 404 rather than 403. */
function newPublicId(): string {
  return randomBytes(18).toString("base64url");
}

/** Ownership in the WHERE clause, never a fetch-then-compare — #2's rule,
 * carried forward unchanged. */
function ownedBy(owner: Owner) {
  return owner.kind === "user"
    ? eq(matrix.userId, owner.userId)
    : and(eq(matrix.ownerSessionId, owner.sessionId), isNull(matrix.userId));
}

// ---------------------------------------------------------------------------
// Per-document extraction
// ---------------------------------------------------------------------------

export async function getExtractionStatus(
  documentId: string,
): Promise<Array<{ kind: string; status: string; error: string | null }>> {
  return getDb()
    .select({ kind: extraction.kind, status: extraction.status, error: extraction.error })
    .from(extraction)
    .where(eq(extraction.documentId, documentId));
}

export async function markExtraction(
  documentId: string,
  kind: "tables" | "findings",
  status: "pending" | "ready" | "failed",
  error: string | null = null,
): Promise<void> {
  await getDb()
    .insert(extraction)
    .values({ documentId, kind, status, error, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [extraction.documentId, extraction.kind],
      set: { status, error, updatedAt: new Date() },
    });
}

/** Re-extraction replaces, so a document never holds two contradictory sets of
 * numbers from two runs of a changing model. */
export async function replaceTables(documentId: string, tables: InterpretedTable[]): Promise<void> {
  await getDb().transaction(async (tx) => {
    await tx.delete(extractedTable).where(eq(extractedTable.documentId, documentId));
    if (tables.length === 0) return;
    await tx.insert(extractedTable).values(
      tables.map((t) => ({
        documentId,
        pageNumber: t.pageNumber,
        caption: t.caption,
        grid: t.grid,
        headerRow: t.headerRow,
        units: t.units,
        confidence: t.confidence,
        description: t.description,
      })),
    );
  });
}

export async function replaceFindings(documentId: string, findings: Finding[]): Promise<void> {
  await getDb().transaction(async (tx) => {
    await tx.delete(extractedFinding).where(eq(extractedFinding.documentId, documentId));
    if (findings.length === 0) return;
    await tx.insert(extractedFinding).values(findings.map((f) => ({ documentId, ...f })));
  });
}

export async function listTables(documentId: string) {
  return getDb()
    .select()
    .from(extractedTable)
    .where(eq(extractedTable.documentId, documentId))
    .orderBy(asc(extractedTable.pageNumber), asc(extractedTable.id));
}

export async function listFindings(documentId: string) {
  return getDb()
    .select()
    .from(extractedFinding)
    .where(eq(extractedFinding.documentId, documentId))
    .orderBy(asc(extractedFinding.pageNumber), asc(extractedFinding.id));
}

// ---------------------------------------------------------------------------
// Matrices
// ---------------------------------------------------------------------------

export async function createMatrix(owner: Owner, title: string) {
  const [row] = await getDb()
    .insert(matrix)
    .values({
      publicId: newPublicId(),
      title,
      userId: owner.kind === "user" ? owner.userId : null,
      ownerSessionId: owner.kind === "anonymous" ? owner.sessionId : null,
    })
    .returning();
  return row;
}

/**
 * Counts come from joins rather than correlated subqueries, and that is not a
 * style preference.
 *
 * drizzle qualifies column references with their table only when a query needs
 * it — a single-table select emits bare `"id"` and `"matrix_id"`. Inside a
 * hand-written `(select count(*) from matrix_row where "matrix_id" = "id")`
 * those both resolve against `matrix_row`, so the subquery silently compares
 * `matrix_row.matrix_id` to `matrix_row.id`, never correlates with the outer
 * row, and returns a plausible wrong number. Observed live: a brand-new matrix
 * reporting 2 papers and 2 fields.
 *
 * `count(distinct ...)` because two joins multiply: without it a matrix with 3
 * rows and 4 columns reports 12 of each.
 */
export async function listMatrices(owner: Owner) {
  return getDb()
    .select({
      publicId: matrix.publicId,
      title: matrix.title,
      updatedAt: matrix.updatedAt,
      rowCount: sql<number>`count(distinct ${matrixRow.id})::int`,
      columnCount: sql<number>`count(distinct ${matrixColumn.id})::int`,
    })
    .from(matrix)
    .leftJoin(matrixRow, eq(matrixRow.matrixId, matrix.id))
    .leftJoin(matrixColumn, eq(matrixColumn.matrixId, matrix.id))
    .where(ownedBy(owner))
    .groupBy(matrix.id)
    .orderBy(desc(matrix.updatedAt));
}

/** Null for a matrix belonging to someone else, so the caller answers 404. */
export async function findMatrix(owner: Owner, publicId: string) {
  const [row] = await getDb()
    .select()
    .from(matrix)
    .where(and(ownedBy(owner), eq(matrix.publicId, publicId)))
    .limit(1);
  return row ?? null;
}

export async function matrixContents(matrixId: number) {
  const db = getDb();
  const [columns, rows, cells] = await Promise.all([
    db
      .select()
      .from(matrixColumn)
      .where(eq(matrixColumn.matrixId, matrixId))
      .orderBy(asc(matrixColumn.position)),
    db
      .select()
      .from(matrixRow)
      .where(eq(matrixRow.matrixId, matrixId))
      .orderBy(asc(matrixRow.position)),
    db.select().from(matrixCell).where(eq(matrixCell.matrixId, matrixId)),
  ]);
  return { columns, rows, cells };
}

async function nextPosition(
  table: typeof matrixColumn | typeof matrixRow,
  matrixId: number,
): Promise<number> {
  const [row] = await getDb()
    .select({ max: sql<number>`coalesce(max(${table.position}), -1)::int` })
    .from(table)
    .where(eq(table.matrixId, matrixId));
  return (row?.max ?? -1) + 1;
}

export async function addColumn(
  matrixId: number,
  label: string,
  hint: string | null,
  valueType: string,
) {
  const [row] = await getDb()
    .insert(matrixColumn)
    .values({
      matrixId,
      position: await nextPosition(matrixColumn, matrixId),
      label,
      hint,
      valueType,
    })
    .returning();
  await touch(matrixId);
  return row;
}

export async function addRow(matrixId: number, documentId: string) {
  const [row] = await getDb()
    .insert(matrixRow)
    .values({ matrixId, documentId, position: await nextPosition(matrixRow, matrixId) })
    .onConflictDoNothing({ target: [matrixRow.matrixId, matrixRow.documentId] })
    .returning();
  await touch(matrixId);
  return row ?? null;
}

export async function removeColumn(matrixId: number, columnId: number): Promise<void> {
  await getDb()
    .delete(matrixColumn)
    .where(and(eq(matrixColumn.matrixId, matrixId), eq(matrixColumn.id, columnId)));
  await touch(matrixId);
}

export async function removeRow(matrixId: number, rowId: number): Promise<void> {
  await getDb()
    .delete(matrixRow)
    .where(and(eq(matrixRow.matrixId, matrixId), eq(matrixRow.id, rowId)));
  await touch(matrixId);
}

export async function saveCell(
  matrixId: number,
  rowId: number,
  columnId: number,
  result: CellResult,
): Promise<void> {
  await getDb()
    .insert(matrixCell)
    .values({ matrixId, rowId, columnId, ...result, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [matrixCell.rowId, matrixCell.columnId],
      set: { ...result, updatedAt: new Date() },
    });
}

async function touch(matrixId: number): Promise<void> {
  await getDb().update(matrix).set({ updatedAt: new Date() }).where(eq(matrix.id, matrixId));
}

/** Which (row, column) pairs have no cell yet, so a refill can skip work
 * already paid for. */
export function missingPairs(
  rows: Array<{ id: number; documentId: string }>,
  columns: Array<{ id: number }>,
  cells: Array<{ rowId: number; columnId: number; status: string }>,
): Array<{ rowId: number; columnId: number; documentId: string }> {
  const done = new Set(
    cells.filter((c) => c.status !== "error").map((c) => `${c.rowId}:${c.columnId}`),
  );
  const pairs: Array<{ rowId: number; columnId: number; documentId: string }> = [];
  for (const row of rows) {
    for (const column of columns) {
      if (done.has(`${row.id}:${column.id}`)) continue;
      pairs.push({ rowId: row.id, columnId: column.id, documentId: row.documentId });
    }
  }
  return pairs;
}

/** Adopts anonymous matrices into an account, filtered on `user_id IS NULL` —
 * the same one-line guarantee as #5's document adoption, and for the same
 * reason: without it, the second person on a shared browser inherits the
 * first's work. */
export async function claimMatrices(userId: string, sessionId: string): Promise<number> {
  const claimed = await getDb()
    .update(matrix)
    .set({ userId, ownerSessionId: null })
    .where(and(eq(matrix.ownerSessionId, sessionId), isNull(matrix.userId)))
    .returning({ id: matrix.id });
  return claimed.length;
}

export async function documentTitles(documentIds: string[]): Promise<Map<string, string>> {
  if (documentIds.length === 0) return new Map();
  const { document } = await import("@/lib/db/schema");
  const rows = await getDb()
    .select({ documentId: document.documentId, filename: document.filename, title: document.title })
    .from(document)
    .where(inArray(document.documentId, documentIds));
  return new Map(rows.map((r) => [r.documentId, r.title ?? r.filename]));
}
