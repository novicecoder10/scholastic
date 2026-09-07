import type { PositionedItem } from "@/lib/pdf/tables";
import { looksLikePdf, MAX_PAGES, NotAPdfError } from "@/lib/pdf/extract";

export interface PagePositions {
  pageNumber: number;
  items: PositionedItem[];
}

/**
 * Positioned text items, page by page. The geometric half of #7 needs
 * coordinates, which `extractText` throws away.
 *
 * Kept beside `extract.ts` and dynamic-importing `unpdf` for the same reason:
 * nothing else in the app touches a PDF library, and the pdfjs bundle must not
 * load merely because a module transitively imports this one.
 */
export async function extractPositions(bytes: Uint8Array): Promise<PagePositions[]> {
  if (!looksLikePdf(bytes)) throw new NotAPdfError();

  const { getDocumentProxy } = await import("unpdf");
  // A copy, because pdfjs detaches the ArrayBuffer it is handed — see the same
  // note in extract.ts, where not copying recorded byteSize: 0 for every
  // upload.
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const pageCount = Math.min(pdf.numPages, MAX_PAGES);

  const pages: PagePositions[] = [];
  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const items: PositionedItem[] = [];

    for (const raw of content.items as Array<Record<string, unknown>>) {
      const text = typeof raw.str === "string" ? raw.str : "";
      if (text.trim() === "") continue;
      const transform = raw.transform as number[] | undefined;
      if (!transform || transform.length < 6) continue;
      items.push({
        text,
        // transform is [scaleX, skewY, skewX, scaleY, translateX, translateY]
        // in PDF user space, whose origin is bottom-left — so a larger y is
        // higher on the page, which is what groupIntoLines assumes.
        x: transform[4],
        y: transform[5],
        width: typeof raw.width === "number" ? raw.width : text.length * (transform[0] || 1),
        // `height` is the glyph box; transform[3] is the font scale and is the
        // more reliable of the two when a producer omits height.
        height: typeof raw.height === "number" && raw.height > 0 ? raw.height : (transform[3] ?? 10),
      });
    }
    pages.push({ pageNumber, items });
  }

  return pages;
}
