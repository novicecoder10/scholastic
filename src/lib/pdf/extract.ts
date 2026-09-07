import type { PageText } from "@/lib/pdf/chunk";

/** Beyond this the marginal value of more pages is low and the cost is not. */
export const MAX_PAGES = 500;

/** A PDF always begins with this signature, whatever Content-Type was declared. */
const PDF_MAGIC = "%PDF-";

export class NotAPdfError extends Error {
  constructor() {
    super("That file isn't a PDF.");
    this.name = "NotAPdfError";
  }
}

export class NoTextLayerError extends Error {
  constructor() {
    super(
      "This PDF has no extractable text — it looks like a scan. Scholastic doesn't do OCR yet.",
    );
    this.name = "NoTextLayerError";
  }
}

/**
 * Checks the file's own bytes rather than the declared Content-Type, which is
 * attacker-controlled in a multipart upload and routinely wrong even when it
 * isn't.
 */
export function looksLikePdf(bytes: Uint8Array): boolean {
  if (bytes.length < PDF_MAGIC.length) return false;
  return Buffer.from(bytes.subarray(0, PDF_MAGIC.length)).toString("latin1") === PDF_MAGIC;
}

export interface ExtractResult {
  pages: PageText[];
  /** Pages actually parsed — capped at MAX_PAGES, so not always the PDF's length. */
  pageCount: number;
  truncated: boolean;
  title: string | null;
}

/**
 * Wraps `unpdf` so nothing else in the app imports a PDF library directly. The
 * import is dynamic because unpdf pulls in a large pdfjs bundle that must not
 * be loaded merely because a module transitively imports this one.
 */
export async function extractPdf(bytes: Uint8Array): Promise<ExtractResult> {
  if (!looksLikePdf(bytes)) throw new NotAPdfError();

  const { extractText, getDocumentProxy, getMeta } = await import("unpdf");
  // pdfjs takes ownership of the ArrayBuffer it is handed and detaches it, so
  // the caller's view would silently become zero-length. Verified against a
  // real PDF: 22246 bytes in, 0 bytes out. A copy keeps this function
  // non-destructive, which every caller reasonably assumes — `ingestPdf` reads
  // `bytes.byteLength` after calling here, and without this would persist
  // byteSize: 0 for every upload.
  const pdf = await getDocumentProxy(new Uint8Array(bytes));

  const truncated = pdf.numPages > MAX_PAGES;
  const pageCount = Math.min(pdf.numPages, MAX_PAGES);

  const { text } = await extractText(pdf, { mergePages: false });
  const pages: PageText[] = (text as string[])
    .slice(0, pageCount)
    .map((pageText, i) => ({ pageNumber: i + 1, text: pageText ?? "" }));

  if (pages.every((p) => p.text.trim().length === 0)) throw new NoTextLayerError();

  let title: string | null = null;
  try {
    const meta = await getMeta(pdf);
    const raw = (meta.info as { Title?: unknown } | undefined)?.Title;
    if (typeof raw === "string" && raw.trim()) title = raw.trim().slice(0, 500);
  } catch {
    // Metadata is a nicety. A PDF with a broken info dictionary still ingests.
  }

  return { pages, pageCount, truncated, title };
}
