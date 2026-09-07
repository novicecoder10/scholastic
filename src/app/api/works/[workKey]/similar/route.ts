import { NextRequest, NextResponse } from "next/server";
import { getSimilarWorks } from "@/lib/ai/similarWorks";
import { WorkNotFoundError } from "@/lib/ai/errors";
import { logger } from "@/lib/log/logger";

interface RouteParams {
  params: Promise<{ workKey: string }>;
}

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 25;

/**
 * GET (not POST) — consistent with `?mode=semantic` being GET despite real
 * embedding-compute cost; only routes that trigger an LLM call are POST in
 * this codebase. A too-sparse corpus (nothing else embedded yet) returns an
 * empty `results` array, not an error — that's an expected early-corpus state,
 * not a failure. An embedding-compute failure has no fallback (ranking
 * against the corpus is meaningless without a vector for the seed work), so
 * that case is a genuine 503 rather than the "degrade silently" pattern used
 * elsewhere in this codebase.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  const { workKey } = await params;
  const limitParam = request.nextUrl.searchParams.get("limit");
  const parsedLimit = limitParam ? Number.parseInt(limitParam, 10) : DEFAULT_LIMIT;
  const limit = Math.min(
    Math.max(Number.isNaN(parsedLimit) ? DEFAULT_LIMIT : parsedLimit, 1),
    MAX_LIMIT,
  );

  try {
    const results = await getSimilarWorks(workKey, limit);
    return NextResponse.json({ results });
  } catch (err) {
    if (err instanceof WorkNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    logger.error(
      { event: "similar_works_request_failed", workKey, err: String(err) },
      "similar works request failed",
    );
    return NextResponse.json({ error: "Failed to compute similar works" }, { status: 503 });
  }
}
