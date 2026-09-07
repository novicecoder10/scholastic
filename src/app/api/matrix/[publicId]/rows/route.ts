import { NextRequest, NextResponse } from "next/server";
import { readOwner } from "@/lib/auth/owner";
import { findOwned } from "@/lib/documents/repository";
import { addRow, findMatrix, removeRow } from "@/lib/extraction/repository";
import { logger } from "@/lib/log/logger";

export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ publicId: string }>;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { publicId } = await params;
  const owner = await readOwner();
  const notFound = NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!owner) return notFound;

  let body: { documentId?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (typeof body.documentId !== "string") {
    return NextResponse.json({ error: "'documentId' is required" }, { status: 400 });
  }

  try {
    const found = await findMatrix(owner, publicId);
    if (!found) return notFound;
    // The document is checked against the same owner, so a matrix cannot be
    // used to pull someone else's upload into a grid.
    if (!(await findOwned(owner, body.documentId))) return notFound;

    const row = await addRow(found.id, body.documentId);
    // Null means the document is already a row. Idempotent rather than a
    // conflict: adding a paper twice is a slip, not an error worth a dialog.
    return NextResponse.json(row ?? { alreadyPresent: true }, { status: row ? 201 : 200 });
  } catch (err) {
    logger.error({ event: "matrix_row_add_failed", err: String(err) }, "row add failed");
    return NextResponse.json({ error: "Couldn't add that paper." }, { status: 503 });
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const { publicId } = await params;
  const owner = await readOwner();
  const notFound = NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!owner) return notFound;

  const rowId = Number.parseInt(request.nextUrl.searchParams.get("rowId") ?? "", 10);
  if (!Number.isInteger(rowId)) {
    return NextResponse.json({ error: "'rowId' is required" }, { status: 400 });
  }

  try {
    const found = await findMatrix(owner, publicId);
    if (!found) return notFound;
    await removeRow(found.id, rowId);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    logger.error({ event: "matrix_row_delete_failed", err: String(err) }, "row delete failed");
    return NextResponse.json({ error: "Couldn't remove that paper." }, { status: 503 });
  }
}
