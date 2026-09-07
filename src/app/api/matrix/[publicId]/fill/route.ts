import { NextRequest, NextResponse } from "next/server";
import { readOwner } from "@/lib/auth/owner";
import { estimateCredits } from "@/lib/credits/cost";
import { fillCells, type CellJob } from "@/lib/extraction/matrix";
import { findMatrix, matrixContents, missingPairs, saveCell } from "@/lib/extraction/repository";
import { logger } from "@/lib/log/logger";

export const runtime = "nodejs";
/** A wide matrix is many sequential provider calls; the default budget is not
 * enough for one. */
export const maxDuration = 300;

interface RouteParams {
  params: Promise<{ publicId: string }>;
}

/**
 * `GET` prices the run, `POST` performs it. Two verbs rather than one because
 * #6's rule is that the cost of an expensive action is shown **before** it runs
 * — a 20x6 matrix is 120 provider calls, and the user is told that before
 * clicking, not after.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  const { publicId } = await params;
  const owner = await readOwner();
  const notFound = NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!owner) return notFound;

  try {
    const found = await findMatrix(owner, publicId);
    if (!found) return notFound;
    const { columns, rows, cells } = await matrixContents(found.id);
    const scope = parseScope(request.nextUrl.searchParams);
    const pairs = pairsForScope(rows, columns, cells, scope);
    return NextResponse.json({
      cells: pairs.length,
      estimate: pairs.length * estimateCredits("matrix_cell"),
    });
  } catch (err) {
    logger.error({ event: "matrix_estimate_failed", err: String(err) }, "estimate failed");
    return NextResponse.json({ error: "Couldn't price that run." }, { status: 503 });
  }
}

interface Scope {
  columnId: number | null;
  rowId: number | null;
  /** Refill cells that already have an answer, not only the missing ones. */
  force: boolean;
}

function parseScope(searchParams: URLSearchParams): Scope {
  const columnId = Number.parseInt(searchParams.get("columnId") ?? "", 10);
  const rowId = Number.parseInt(searchParams.get("rowId") ?? "", 10);
  return {
    columnId: Number.isInteger(columnId) ? columnId : null,
    rowId: Number.isInteger(rowId) ? rowId : null,
    force: searchParams.get("force") === "1",
  };
}

/** Column- and row-scoped refills exist so partial work is not re-paid for:
 * refining one field's wording should cost one column, not the grid. */
function pairsForScope(
  rows: Array<{ id: number; documentId: string }>,
  columns: Array<{ id: number }>,
  cells: Array<{ rowId: number; columnId: number; status: string }>,
  scope: Scope,
) {
  const inScopeRows = scope.rowId ? rows.filter((r) => r.id === scope.rowId) : rows;
  const inScopeColumns = scope.columnId ? columns.filter((c) => c.id === scope.columnId) : columns;
  if (scope.force) {
    return inScopeRows.flatMap((row) =>
      inScopeColumns.map((column) => ({
        rowId: row.id,
        columnId: column.id,
        documentId: row.documentId,
      })),
    );
  }
  return missingPairs(inScopeRows, inScopeColumns, cells);
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { publicId } = await params;
  const owner = await readOwner();
  const notFound = NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!owner) return notFound;

  try {
    const found = await findMatrix(owner, publicId);
    if (!found) return notFound;

    const { columns, rows, cells } = await matrixContents(found.id);
    const byId = new Map(columns.map((c) => [c.id, c]));
    const pairs = pairsForScope(rows, columns, cells, parseScope(request.nextUrl.searchParams));

    const jobs: CellJob[] = pairs.flatMap((pair) => {
      const column = byId.get(pair.columnId);
      if (!column) return [];
      return [
        {
          rowId: pair.rowId,
          documentId: pair.documentId,
          column: {
            id: column.id,
            label: column.label,
            hint: column.hint,
            valueType: column.valueType,
          },
        },
      ];
    });

    let filled = 0;
    let notReported = 0;
    let errors = 0;
    await fillCells(jobs, async (job, result) => {
      await saveCell(found.id, job.rowId, job.column.id, result);
      if (result.status === "found") filled += 1;
      else if (result.status === "not_reported") notReported += 1;
      else errors += 1;
    });

    return NextResponse.json({ ran: jobs.length, filled, notReported, errors });
  } catch (err) {
    logger.error({ event: "matrix_fill_failed", err: String(err) }, "matrix fill failed");
    return NextResponse.json({ error: "Couldn't fill that matrix." }, { status: 503 });
  }
}
