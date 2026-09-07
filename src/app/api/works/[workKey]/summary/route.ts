import { NextRequest, NextResponse } from "next/server";
import {
  getOrCreateSummary,
  SummaryFeatureDisabledError,
  WorkNotFoundError,
} from "@/lib/ai/summary";
import {
  insufficientCreditsResponse,
  isInsufficientCredits,
} from "@/lib/credits/apiResponse";
import { logger } from "@/lib/log/logger";

interface RouteParams {
  params: Promise<{ workKey: string }>;
}

/**
 * POST (not GET) because generating a summary triggers an LLM call with real
 * cost/latency on a cache miss — not a pure, freely-repeatable read the way
 * GET /api/search is. Returns 503 (not a crash) when AI summaries aren't
 * configured on this instance, and 404 if the workKey doesn't match any
 * previously-searched work — same graceful, typed-error philosophy as the
 * rest of this app's external-dependency handling.
 */
export async function POST(_request: NextRequest, { params }: RouteParams) {
  const { workKey } = await params;

  try {
    const result = await getOrCreateSummary(workKey);
    return NextResponse.json(result);
  } catch (err) {
    if (isInsufficientCredits(err)) return insufficientCreditsResponse(err);
    if (err instanceof SummaryFeatureDisabledError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    if (err instanceof WorkNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    logger.error(
      { event: "summary_request_failed", workKey, err: String(err) },
      "summary request failed",
    );
    return NextResponse.json({ error: "Failed to generate summary" }, { status: 500 });
  }
}
