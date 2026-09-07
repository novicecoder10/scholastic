import { NextRequest, NextResponse } from "next/server";
import { requireUserApi } from "@/lib/auth/apiGuard";
import {
  deleteCollection,
  findCollection,
  listCollectionItems,
  reorderCollection,
} from "@/lib/library/repository";
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
    const found = await findCollection(auth.user.id, publicId);
    // Another user's collection is indistinguishable from one that isn't
    // there, exactly as #2's documents are.
    if (!found) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ collection: found, items: await listCollectionItems(found.id) });
  } catch (err) {
    logger.error({ event: "collection_get_failed", err: String(err) }, "collection fetch failed");
    return NextResponse.json({ error: "Couldn't load that collection." }, { status: 503 });
  }
}

/** Reorder. The body is the full ordered list of saved-item ids. */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const auth = await requireUserApi();
  if ("response" in auth) return auth.response;
  const { publicId } = await params;

  let body: { order?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!Array.isArray(body.order) || !body.order.every((n) => Number.isInteger(n))) {
    return NextResponse.json({ error: "'order' must be an array of item ids" }, { status: 400 });
  }

  try {
    const ok = await reorderCollection(auth.user.id, publicId, body.order as number[]);
    return ok
      ? new NextResponse(null, { status: 204 })
      : NextResponse.json({ error: "Not found" }, { status: 404 });
  } catch (err) {
    logger.error({ event: "collection_reorder_failed", err: String(err) }, "reorder failed");
    return NextResponse.json({ error: "Couldn't reorder that collection." }, { status: 503 });
  }
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const auth = await requireUserApi();
  if ("response" in auth) return auth.response;
  const { publicId } = await params;

  try {
    const removed = await deleteCollection(auth.user.id, publicId);
    return removed
      ? new NextResponse(null, { status: 204 })
      : NextResponse.json({ error: "Not found" }, { status: 404 });
  } catch (err) {
    logger.error({ event: "collection_delete_failed", err: String(err) }, "delete failed");
    return NextResponse.json({ error: "Couldn't delete that collection." }, { status: 503 });
  }
}
