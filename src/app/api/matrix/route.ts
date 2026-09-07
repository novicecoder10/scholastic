import { NextRequest, NextResponse } from "next/server";
import { resolveOwner } from "@/lib/auth/owner";
import { createMatrix, listMatrices } from "@/lib/extraction/repository";
import { logger } from "@/lib/log/logger";

export const runtime = "nodejs";

const MAX_TITLE = 120;

export async function GET() {
  try {
    return NextResponse.json({ matrices: await listMatrices(await resolveOwner()) });
  } catch (err) {
    logger.error({ event: "matrix_list_failed", err: String(err) }, "matrix list failed");
    return NextResponse.json({ error: "Couldn't load your matrices." }, { status: 503 });
  }
}

export async function POST(request: NextRequest) {
  let body: { title?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) return NextResponse.json({ error: "A title is required." }, { status: 400 });
  if (title.length > MAX_TITLE) {
    return NextResponse.json(
      { error: `Titles are limited to ${MAX_TITLE} characters.` },
      { status: 400 },
    );
  }

  try {
    // resolveOwner, not readOwner: an anonymous visitor creating their first
    // matrix needs a session cookie minted, exactly as their first upload does.
    return NextResponse.json(await createMatrix(await resolveOwner(), title), { status: 201 });
  } catch (err) {
    logger.error({ event: "matrix_create_failed", err: String(err) }, "matrix create failed");
    return NextResponse.json({ error: "Couldn't create that matrix." }, { status: 503 });
  }
}
