import { NextRequest, NextResponse } from "next/server";
import { readOwner } from "@/lib/auth/owner";
import { deleteDocument, findOwned } from "@/lib/documents/repository";
import { getBlobStore } from "@/lib/storage";
import { logger } from "@/lib/log/logger";

export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ documentId: string }>;
}

/**
 * A document belonging to someone else answers 404, identical to one that
 * doesn't exist. A 403 would confirm the id is real, which defeats the point
 * of an unguessable capability token.
 */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { documentId } = await params;
  const owner = await readOwner();
  if (!owner) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    const record = await findOwned(owner, documentId);
    if (!record) return NextResponse.json({ error: "Not found" }, { status: 404 });
    // storageKey is deliberately not serialised — it's an internal blob
    // address, and nothing outside the storage layer has any use for it.
    return NextResponse.json({
      documentId: record.documentId,
      filename: record.filename,
      byteSize: record.byteSize,
      status: record.status,
      pageCount: record.pageCount,
      truncated: record.truncated,
      title: record.title,
      createdAt: record.createdAt,
    });
  } catch (err) {
    logger.error({ event: "document_get_failed", err: String(err) }, "document fetch failed");
    return NextResponse.json({ error: "Couldn't load that document." }, { status: 503 });
  }
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const { documentId } = await params;
  const owner = await readOwner();
  if (!owner) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    const record = await findOwned(owner, documentId);
    if (!record) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const deleted = await deleteDocument(owner, documentId);
    if (!deleted) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Blob removal after the rows are gone: an orphaned blob wastes disk, an
    // orphaned row breaks the reader.
    await getBlobStore()
      .delete(record.storageKey)
      .catch((err) =>
        logger.warn(
          { event: "document_blob_delete_failed", documentId, err: String(err) },
          "document rows deleted but blob remains",
        ),
      );

    return new NextResponse(null, { status: 204 });
  } catch (err) {
    logger.error({ event: "document_delete_failed", err: String(err) }, "document delete failed");
    return NextResponse.json({ error: "Couldn't delete that document." }, { status: 503 });
  }
}
