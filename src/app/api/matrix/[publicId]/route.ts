import { NextRequest, NextResponse } from "next/server";
import { readOwner } from "@/lib/auth/owner";
import { documentTitles, findMatrix, matrixContents } from "@/lib/extraction/repository";
import { logger } from "@/lib/log/logger";

export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ publicId: string }>;
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { publicId } = await params;
  const owner = await readOwner();
  const notFound = NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!owner) return notFound;

  try {
    const found = await findMatrix(owner, publicId);
    if (!found) return notFound;
    const contents = await matrixContents(found.id);
    const titles = await documentTitles(contents.rows.map((r) => r.documentId));
    return NextResponse.json({
      title: found.title,
      publicId: found.publicId,
      ...contents,
      rows: contents.rows.map((r) => ({ ...r, title: titles.get(r.documentId) ?? r.documentId })),
    });
  } catch (err) {
    logger.error({ event: "matrix_read_failed", err: String(err) }, "matrix read failed");
    return NextResponse.json({ error: "Couldn't load that matrix." }, { status: 503 });
  }
}
