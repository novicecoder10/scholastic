import { NextRequest, NextResponse } from "next/server";
import { requireUserApi } from "@/lib/auth/apiGuard";
import {
  createCollection,
  DuplicateCollectionNameError,
  listCollections,
} from "@/lib/library/repository";
import { logger } from "@/lib/log/logger";

export const runtime = "nodejs";

const MAX_NAME_LENGTH = 120;

export async function GET() {
  const auth = await requireUserApi();
  if ("response" in auth) return auth.response;
  try {
    return NextResponse.json({ collections: await listCollections(auth.user.id) });
  } catch (err) {
    logger.error({ event: "collections_list_failed", err: String(err) }, "collections list failed");
    return NextResponse.json({ error: "Couldn't load your collections." }, { status: 503 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireUserApi();
  if ("response" in auth) return auth.response;

  let body: { name?: unknown; description?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return NextResponse.json({ error: "A name is required." }, { status: 400 });
  if (name.length > MAX_NAME_LENGTH) {
    return NextResponse.json(
      { error: `Names are limited to ${MAX_NAME_LENGTH} characters.` },
      { status: 400 },
    );
  }

  try {
    const created = await createCollection(
      auth.user.id,
      name,
      typeof body.description === "string" ? body.description : null,
    );
    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    // 409, not 400: the request was well-formed, it conflicts with existing state.
    if (err instanceof DuplicateCollectionNameError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    logger.error(
      { event: "collection_create_failed", err: String(err) },
      "collection create failed",
    );
    return NextResponse.json({ error: "Couldn't create that collection." }, { status: 503 });
  }
}
