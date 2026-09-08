import { NextRequest, NextResponse } from "next/server";
import { readOwner } from "@/lib/auth/owner";
import { addColumn, findMatrix, removeColumn } from "@/lib/extraction/repository";
import { logger } from "@/lib/log/logger";

export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ publicId: string }>;
}

const VALUE_TYPES = new Set(["text", "number", "list"]);
const MAX_LABEL = 80;

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { publicId } = await params;
  const owner = await readOwner();
  const notFound = NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!owner) return notFound;

  let body: { label?: unknown; hint?: unknown; valueType?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const label = typeof body.label === "string" ? body.label.trim() : "";
  if (!label) return NextResponse.json({ error: "A field name is required." }, { status: 400 });
  if (label.length > MAX_LABEL) {
    return NextResponse.json(
      { error: `Field names are limited to ${MAX_LABEL} characters.` },
      { status: 400 },
    );
  }
  const valueType = typeof body.valueType === "string" ? body.valueType : "text";
  if (!VALUE_TYPES.has(valueType)) {
    return NextResponse.json(
      { error: "'valueType' must be text, number or list" },
      { status: 400 },
    );
  }

  try {
    const found = await findMatrix(owner, publicId);
    if (!found) return notFound;
    const hint = typeof body.hint === "string" && body.hint.trim() ? body.hint.trim() : null;
    return NextResponse.json(await addColumn(found.id, label, hint, valueType), { status: 201 });
  } catch (err) {
    logger.error({ event: "matrix_column_add_failed", err: String(err) }, "column add failed");
    return NextResponse.json({ error: "Couldn't add that column." }, { status: 503 });
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const { publicId } = await params;
  const owner = await readOwner();
  const notFound = NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!owner) return notFound;

  const columnId = Number.parseInt(request.nextUrl.searchParams.get("columnId") ?? "", 10);
  if (!Number.isInteger(columnId)) {
    return NextResponse.json({ error: "'columnId' is required" }, { status: 400 });
  }

  try {
    const found = await findMatrix(owner, publicId);
    if (!found) return notFound;
    await removeColumn(found.id, columnId);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    logger.error(
      { event: "matrix_column_delete_failed", err: String(err) },
      "column delete failed",
    );
    return NextResponse.json({ error: "Couldn't remove that column." }, { status: 503 });
  }
}
