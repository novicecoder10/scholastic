import { NextRequest, NextResponse } from "next/server";
import { requireUserApi } from "@/lib/auth/apiGuard";
import { collectCitedWorkKeys } from "@/lib/manuscript/bibliography";
import { exportManuscript, type ExportFormat } from "@/lib/manuscript/export";
import { findManuscript } from "@/lib/manuscript/repository";
import { resolveWorks } from "@/lib/manuscript/resolve";
import type { CitationStyle } from "@/lib/citations";
import type { DocNode } from "@/lib/manuscript/types";
import { logger } from "@/lib/log/logger";

export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ publicId: string }>;
}

const FORMATS = new Set<ExportFormat>(["markdown", "latex", "bibtex", "ris"]);

/**
 * Every export is free and deterministic — it is #4's formatters over resolved
 * works, with no model anywhere. That is what makes the editor genuinely
 * usable on an instance with no AI configured.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  const auth = await requireUserApi();
  if ("response" in auth) return auth.response;
  const { publicId } = await params;

  const requested = (request.nextUrl.searchParams.get("format") ?? "markdown") as ExportFormat;
  if (!FORMATS.has(requested)) {
    return NextResponse.json(
      { error: `Unknown format. Supported: ${[...FORMATS].join(", ")}` },
      { status: 400 },
    );
  }

  try {
    const found = await findManuscript(auth.user.id, publicId);
    if (!found) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const doc = found.doc as DocNode;
    const resolved = await resolveWorks(auth.user.id, collectCitedWorkKeys(doc));
    const result = exportManuscript(
      doc,
      found.title,
      resolved,
      found.citationStyle as CitationStyle,
      requested,
    );

    // LaTeX needs two files. Rather than reach for a zip dependency for one
    // format, the .bib is appended behind a comment banner that TeX ignores and
    // a human can split in one paste.
    const body =
      result.bib !== undefined
        ? `${result.content}\n\n% ---------------------------------------------------------------\n% Save everything below as ${result.filename.replace(/\.tex$/, ".bib")}\n% ---------------------------------------------------------------\n${result.bib}`
        : result.content;

    return new NextResponse(body, {
      headers: {
        "Content-Type": result.contentType,
        "Content-Disposition": `attachment; filename="${result.filename}"`,
      },
    });
  } catch (err) {
    logger.error({ event: "manuscript_export_failed", err: String(err) }, "export failed");
    return NextResponse.json({ error: "Couldn't export that manuscript." }, { status: 503 });
  }
}
