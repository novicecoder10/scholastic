import { NextRequest, NextResponse } from "next/server";
import { requireUserApi } from "@/lib/auth/apiGuard";
import { createManuscript, listManuscripts } from "@/lib/manuscript/repository";
import { logger } from "@/lib/log/logger";

export const runtime = "nodejs";

const MAX_TITLE = 200;

export async function GET() {
  const auth = await requireUserApi();
  if ("response" in auth) return auth.response;
  try {
    return NextResponse.json({ manuscripts: await listManuscripts(auth.user.id) });
  } catch (err) {
    logger.error({ event: "manuscript_list_failed", err: String(err) }, "manuscript list failed");
    return NextResponse.json({ error: "Couldn't load your manuscripts." }, { status: 503 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireUserApi();
  if ("response" in auth) return auth.response;

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
    return NextResponse.json(await createManuscript(auth.user.id, title), { status: 201 });
  } catch (err) {
    logger.error({ event: "manuscript_create_failed", err: String(err) }, "create failed");
    return NextResponse.json({ error: "Couldn't create that manuscript." }, { status: 503 });
  }
}
