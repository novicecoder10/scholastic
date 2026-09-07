import { NextRequest, NextResponse } from "next/server";
import { requireUserApi } from "@/lib/auth/apiGuard";
import { listSavedItems, saveDocument, saveWork, unsaveWork } from "@/lib/library/repository";
import { findOwned } from "@/lib/documents/repository";
import { resolveOwner } from "@/lib/auth/owner";
import { logger } from "@/lib/log/logger";
import type { CanonicalWork } from "@/lib/types/work";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const auth = await requireUserApi();
  if ("response" in auth) return auth.response;

  const type = request.nextUrl.searchParams.get("type");
  if (type !== null && type !== "work" && type !== "document") {
    return NextResponse.json({ error: "'type' must be 'work' or 'document'" }, { status: 400 });
  }

  try {
    return NextResponse.json({ items: await listSavedItems(auth.user.id, type ?? undefined) });
  } catch (err) {
    logger.error({ event: "library_list_failed", err: String(err) }, "library list failed");
    return NextResponse.json({ error: "Couldn't load your library." }, { status: 503 });
  }
}

interface SaveBody {
  itemType: "work" | "document";
  work?: CanonicalWork;
  documentId?: string;
  note?: string;
}

export async function POST(request: NextRequest) {
  const auth = await requireUserApi();
  if ("response" in auth) return auth.response;

  let body: SaveBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    if (body.itemType === "work") {
      if (!body.work || typeof body.work.workKey !== "string") {
        return NextResponse.json({ error: "'work' must be a CanonicalWork" }, { status: 400 });
      }
      const item = await saveWork(auth.user.id, body.work, body.note ?? null);
      return NextResponse.json(item, { status: 201 });
    }

    if (body.itemType === "document") {
      if (typeof body.documentId !== "string") {
        return NextResponse.json({ error: "'documentId' is required" }, { status: 400 });
      }
      // Saving someone else's document id must not succeed, and must not be
      // distinguishable from saving one that doesn't exist — the same 404 the
      // rest of #2 gives.
      const owner = await resolveOwner();
      if (!(await findOwned(owner, body.documentId))) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      const item = await saveDocument(auth.user.id, body.documentId);
      return NextResponse.json(item, { status: 201 });
    }

    return NextResponse.json({ error: "'itemType' must be 'work' or 'document'" }, { status: 400 });
  } catch (err) {
    logger.error({ event: "library_save_failed", err: String(err) }, "library save failed");
    return NextResponse.json({ error: "Couldn't save that." }, { status: 503 });
  }
}

/** Unsave by workKey — the result card knows that, not the saved-item id. */
export async function DELETE(request: NextRequest) {
  const auth = await requireUserApi();
  if ("response" in auth) return auth.response;

  const workKey = request.nextUrl.searchParams.get("workKey");
  if (!workKey) return NextResponse.json({ error: "'workKey' is required" }, { status: 400 });

  try {
    const removed = await unsaveWork(auth.user.id, workKey);
    return removed
      ? new NextResponse(null, { status: 204 })
      : NextResponse.json({ error: "Not found" }, { status: 404 });
  } catch (err) {
    logger.error({ event: "library_unsave_failed", err: String(err) }, "library unsave failed");
    return NextResponse.json({ error: "Couldn't remove that." }, { status: 503 });
  }
}
