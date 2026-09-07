import { NextRequest, NextResponse } from "next/server";
import { requireUserApi } from "@/lib/auth/apiGuard";
import { addToCollection, removeFromCollection } from "@/lib/library/repository";
import { logger } from "@/lib/log/logger";

export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ publicId: string }>;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const auth = await requireUserApi();
  if ("response" in auth) return auth.response;
  const { publicId } = await params;

  let body: { savedItemId?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!Number.isInteger(body.savedItemId)) {
    return NextResponse.json({ error: "'savedItemId' must be an integer" }, { status: 400 });
  }

  try {
    // addToCollection checks ownership of BOTH the collection and the item, so
    // a 404 here covers "not your collection" and "not your item" alike.
    const ok = await addToCollection(auth.user.id, publicId, body.savedItemId as number);
    return ok
      ? new NextResponse(null, { status: 204 })
      : NextResponse.json({ error: "Not found" }, { status: 404 });
  } catch (err) {
    logger.error({ event: "collection_add_failed", err: String(err) }, "collection add failed");
    return NextResponse.json({ error: "Couldn't add that item." }, { status: 503 });
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const auth = await requireUserApi();
  if ("response" in auth) return auth.response;
  const { publicId } = await params;

  const raw = request.nextUrl.searchParams.get("savedItemId");
  const savedItemId = raw === null ? NaN : Number(raw);
  if (!Number.isInteger(savedItemId)) {
    return NextResponse.json({ error: "'savedItemId' must be an integer" }, { status: 400 });
  }

  try {
    const ok = await removeFromCollection(auth.user.id, publicId, savedItemId);
    return ok
      ? new NextResponse(null, { status: 204 })
      : NextResponse.json({ error: "Not found" }, { status: 404 });
  } catch (err) {
    logger.error({ event: "collection_remove_failed", err: String(err) }, "remove failed");
    return NextResponse.json({ error: "Couldn't remove that item." }, { status: 503 });
  }
}
