import { NextRequest, NextResponse } from "next/server";
import { readOwner } from "@/lib/auth/owner";
import { findOwned } from "@/lib/documents/repository";
import { extractFindings, extractTables, interpretTable } from "@/lib/extraction/extract";
import {
  listFindings,
  listTables,
  markExtraction,
  replaceFindings,
  replaceTables,
} from "@/lib/extraction/repository";
import { getBlobStore } from "@/lib/storage";
import { logger } from "@/lib/log/logger";

export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ documentId: string }>;
}

/** Unowned and nonexistent are the same answer, as everywhere a document id
 * appears — a 403 would confirm the capability token is real. */
const notFound = () => NextResponse.json({ error: "Not found" }, { status: 404 });

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { documentId } = await params;
  const owner = await readOwner();
  if (!owner) return notFound();
  if (!(await findOwned(owner, documentId))) return notFound();

  try {
    const [tables, findings] = await Promise.all([
      listTables(documentId),
      listFindings(documentId),
    ]);
    return NextResponse.json({ tables, findings });
  } catch (err) {
    logger.error({ event: "extraction_read_failed", err: String(err) }, "extraction read failed");
    return NextResponse.json({ error: "Couldn't load extracted data." }, { status: 503 });
  }
}

/**
 * Runs both halves, and deliberately does not treat them as one operation.
 *
 * Table geometry is free and needs no provider, so it must still succeed on an
 * instance with no LLM configured or a balance at zero. Findings need both.
 * Reporting one status for the pair would make a perfectly good set of tables
 * look like a failure.
 */
export async function POST(_request: NextRequest, { params }: RouteParams) {
  const { documentId } = await params;
  const owner = await readOwner();
  if (!owner) return notFound();
  const record = await findOwned(owner, documentId);
  if (!record) return notFound();

  let tablesReady = false;
  try {
    await markExtraction(documentId, "tables", "pending");
    // The store hands back a stream; pdfjs needs the whole buffer, and a PDF
    // capped at 500 pages by #2 is small enough to hold.
    const bytes = new Uint8Array(
      await new Response(await getBlobStore().get(record.storageKey)).arrayBuffer(),
    );
    const detected = await extractTables(bytes);
    const interpreted = await Promise.all(detected.map(interpretTable));
    await replaceTables(documentId, interpreted);
    await markExtraction(documentId, "tables", "ready");
    tablesReady = true;
  } catch (err) {
    logger.error({ event: "table_extraction_failed", err: String(err) }, "table extraction failed");
    await markExtraction(documentId, "tables", "failed", "Couldn't read tables from this PDF.");
  }

  try {
    await markExtraction(documentId, "findings", "pending");
    await replaceFindings(documentId, await extractFindings(documentId));
    await markExtraction(documentId, "findings", "ready");
  } catch (err) {
    logger.error({ event: "findings_failed", err: String(err) }, "findings extraction failed");
    await markExtraction(documentId, "findings", "failed", "Couldn't extract reported statistics.");
  }

  const [tables, findings] = await Promise.all([listTables(documentId), listFindings(documentId)]);
  return NextResponse.json({ tables, findings, tablesReady });
}
