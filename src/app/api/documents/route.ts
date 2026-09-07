import { NextRequest, NextResponse } from "next/server";
import { getOrCreateSessionId } from "@/lib/documents/session";
import { resolveOwner } from "@/lib/auth/owner";
import {
  ensureIndexed,
  FileTooLargeError,
  ingestPdf,
  MAX_UPLOAD_BYTES,
} from "@/lib/documents/ingest";
import { listOwned } from "@/lib/documents/repository";
import { NoTextLayerError, NotAPdfError } from "@/lib/pdf/extract";
import { logger } from "@/lib/log/logger";

export const runtime = "nodejs";

export async function GET() {
  const owner = await resolveOwner();
  try {
    return NextResponse.json({ documents: await listOwned(owner) });
  } catch (err) {
    logger.error({ event: "document_list_failed", err: String(err) }, "document list failed");
    return NextResponse.json({ error: "Couldn't load your documents." }, { status: 503 });
  }
}

/**
 * Unlike every other route in this app, an upload genuinely cannot degrade
 * without a database — there is nowhere else to put the chunks. So this is the
 * one endpoint that returns 503 when Postgres is unreachable, rather than
 * quietly carrying on. See KNOWN_LIMITATIONS.md.
 */
export async function POST(request: NextRequest) {
  // Both identities are captured: the account (if any) owns the row, and the
  // browser session is recorded alongside so the upload survives account
  // deletion. resolveOwner() may mint the session cookie, so the two calls are
  // ordered — getOrCreateSessionId() second is a no-op once it exists.
  const owner = await resolveOwner();
  const sessionId = await getOrCreateSessionId();

  let file: File | null = null;
  try {
    const form = await request.formData();
    const field = form.get("file");
    if (field instanceof File) file = field;
  } catch {
    return NextResponse.json({ error: "Expected a multipart form upload." }, { status: 400 });
  }
  if (!file) {
    return NextResponse.json(
      { error: "No file was uploaded (field name: file)." },
      { status: 400 },
    );
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { error: `That file is larger than ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB.` },
      { status: 413 },
    );
  }

  const bytes = new Uint8Array(await file.arrayBuffer());

  try {
    const record = await ingestPdf({
      owner,
      ownerSessionId: sessionId,
      filename: file.name || "document.pdf",
      bytes,
    });

    // Un-awaited: embedding a long paper takes far longer than the upload
    // itself, and the document is already usable via lexical retrieval.
    void ensureIndexed(record.documentId).catch(() => {});

    return NextResponse.json(record, { status: 201 });
  } catch (err) {
    if (err instanceof FileTooLargeError) {
      return NextResponse.json({ error: err.message }, { status: 413 });
    }
    if (err instanceof NotAPdfError || err instanceof NoTextLayerError) {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    logger.error({ event: "document_upload_failed", err: String(err) }, "document upload failed");
    return NextResponse.json({ error: "Couldn't store that document right now." }, { status: 503 });
  }
}
