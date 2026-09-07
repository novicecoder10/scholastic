import { NextRequest, NextResponse } from "next/server";
import { readOwner } from "@/lib/auth/owner";
import { findOwned } from "@/lib/documents/repository";
import { getBlobStore } from "@/lib/storage";
import { logger } from "@/lib/log/logger";

export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ documentId: string }>;
}

/** Streams the original bytes back for the reader's PDF pane. */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { documentId } = await params;
  const owner = await readOwner();
  if (!owner) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    const record = await findOwned(owner, documentId);
    if (!record) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const stream = await getBlobStore().get(record.storageKey);
    return new NextResponse(stream, {
      headers: {
        "Content-Type": "application/pdf",
        // inline, and the filename is quoted and stripped of quotes/newlines
        // so a crafted upload name can't inject a second header directive.
        "Content-Disposition": `inline; filename="${record.filename.replace(/["\r\n]/g, "")}"`,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (err) {
    logger.error({ event: "document_file_failed", err: String(err) }, "document file fetch failed");
    return NextResponse.json({ error: "Couldn't load that file." }, { status: 503 });
  }
}
