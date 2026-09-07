import { NextRequest, NextResponse } from "next/server";
import { requireUserApi } from "@/lib/auth/apiGuard";
import { findCollection, listCollectionItems } from "@/lib/library/repository";
import { formatCitation, type CitationStyle } from "@/lib/citations";
import { logger } from "@/lib/log/logger";

export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ publicId: string }>;
}

const EXPORTABLE: Record<string, { style: CitationStyle; contentType: string; extension: string }> =
  {
    bibtex: { style: "bibtex", contentType: "application/x-bibtex", extension: "bib" },
    ris: { style: "ris", contentType: "application/x-research-info-systems", extension: "ris" },
  };

/** Filenames go into a Content-Disposition header, where a quote or a newline
 * would let a collection name forge header content. */
function safeFilename(name: string, extension: string): string {
  const base = name.replace(/[^A-Za-z0-9 _-]/g, "").trim() || "collection";
  return `${base.slice(0, 60)}.${extension}`;
}

/**
 * Exporting a collection is close to free because #4 already wrote the BibTeX
 * and RIS formatters against CSL-JSON. It is also the cheapest single thing
 * that makes a library feel like a library rather than a list, which is why it
 * is here rather than deferred.
 *
 * Only saved *papers* export: an uploaded PDF has no bibliographic record to
 * emit, and inventing one is exactly what #4 refused to do.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  const auth = await requireUserApi();
  if ("response" in auth) return auth.response;
  const { publicId } = await params;

  const requested = request.nextUrl.searchParams.get("format") ?? "bibtex";
  const target = EXPORTABLE[requested];
  if (!target) {
    return NextResponse.json(
      { error: `'format' must be one of ${Object.keys(EXPORTABLE).join(", ")}` },
      { status: 400 },
    );
  }

  try {
    const found = await findCollection(auth.user.id, publicId);
    if (!found) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const body = (await listCollectionItems(found.id))
      .map((item) => item.workSnapshot)
      .filter((work) => work !== null)
      .map((work) => formatCitation(work, target.style).text)
      .join("\n\n");

    return new NextResponse(body, {
      headers: {
        "Content-Type": `${target.contentType}; charset=utf-8`,
        "Content-Disposition": `attachment; filename="${safeFilename(found.name, target.extension)}"`,
      },
    });
  } catch (err) {
    logger.error({ event: "collection_export_failed", err: String(err) }, "export failed");
    return NextResponse.json({ error: "Couldn't export that collection." }, { status: 503 });
  }
}
