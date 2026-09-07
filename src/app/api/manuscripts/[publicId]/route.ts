import { NextRequest, NextResponse } from "next/server";
import { requireUserApi } from "@/lib/auth/apiGuard";
import { isManuscriptStyle } from "@/lib/manuscript/bibliography";
import { collectCitedWorkKeys, buildBibliography } from "@/lib/manuscript/bibliography";
import {
  deleteManuscript,
  findManuscript,
  saveManuscript,
} from "@/lib/manuscript/repository";
import { resolveWorks } from "@/lib/manuscript/resolve";
import type { CitationStyle } from "@/lib/citations";
import type { DocNode } from "@/lib/manuscript/types";
import { logger } from "@/lib/log/logger";

export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ publicId: string }>;
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const auth = await requireUserApi();
  if ("response" in auth) return auth.response;
  const { publicId } = await params;

  try {
    const found = await findManuscript(auth.user.id, publicId);
    if (!found) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const order = collectCitedWorkKeys(found.doc as DocNode);
    const resolved = await resolveWorks(auth.user.id, order);
    return NextResponse.json({
      publicId: found.publicId,
      title: found.title,
      doc: found.doc,
      citationStyle: found.citationStyle,
      bibliography: buildBibliography(order, resolved, found.citationStyle as CitationStyle),
    });
  } catch (err) {
    logger.error({ event: "manuscript_read_failed", err: String(err) }, "manuscript read failed");
    return NextResponse.json({ error: "Couldn't load that manuscript." }, { status: 503 });
  }
}

/**
 * Autosave target. Answers with the freshly derived bibliography so the editor
 * never computes labels itself — the document holds workKeys and nothing else,
 * and every label in the UI comes from the same code that formats the export.
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const auth = await requireUserApi();
  if ("response" in auth) return auth.response;
  const { publicId } = await params;

  let body: { doc?: unknown; title?: unknown; citationStyle?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (body.doc !== undefined && (typeof body.doc !== "object" || body.doc === null)) {
    return NextResponse.json({ error: "'doc' must be a document object" }, { status: 400 });
  }
  if (body.citationStyle !== undefined && !isManuscriptStyle(String(body.citationStyle))) {
    return NextResponse.json(
      { error: "A manuscript style must be APA, MLA or Chicago." },
      { status: 400 },
    );
  }

  try {
    const saved = await saveManuscript(auth.user.id, publicId, {
      doc: body.doc as DocNode | undefined,
      title: typeof body.title === "string" ? body.title.trim() : undefined,
      citationStyle: body.citationStyle as string | undefined,
    });
    if (!saved) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const found = await findManuscript(auth.user.id, publicId);
    const order = collectCitedWorkKeys(found?.doc as DocNode);
    const resolved = await resolveWorks(auth.user.id, order);
    return NextResponse.json({
      bibliography: buildBibliography(order, resolved, (found?.citationStyle ?? "apa") as CitationStyle),
    });
  } catch (err) {
    logger.error({ event: "manuscript_save_failed", err: String(err) }, "manuscript save failed");
    return NextResponse.json({ error: "Couldn't save." }, { status: 503 });
  }
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const auth = await requireUserApi();
  if ("response" in auth) return auth.response;
  const { publicId } = await params;

  try {
    const deleted = await deleteManuscript(auth.user.id, publicId);
    if (!deleted) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    logger.error({ event: "manuscript_delete_failed", err: String(err) }, "delete failed");
    return NextResponse.json({ error: "Couldn't delete that manuscript." }, { status: 503 });
  }
}
