import { NextRequest, NextResponse } from "next/server";
import { getCitationReasoning, CitationReasoningDisabledError } from "@/lib/ai/citations/reasoning";
import { insufficientCreditsResponse, isInsufficientCredits } from "@/lib/credits/apiResponse";
import { logger } from "@/lib/log/logger";

interface RequestBody {
  citingDoi: string;
  citedDoi: string;
}

/** POST — triggers a real LLM call on a cache miss, same cost-signaling
 * rationale as summary's POST-not-GET. */
export async function POST(request: NextRequest) {
  let body: RequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (
    typeof body.citingDoi !== "string" ||
    !body.citingDoi.trim() ||
    typeof body.citedDoi !== "string" ||
    !body.citedDoi.trim()
  ) {
    return NextResponse.json(
      { error: "'citingDoi' and 'citedDoi' are both required" },
      { status: 400 },
    );
  }

  try {
    const result = await getCitationReasoning(body.citingDoi, body.citedDoi);
    return NextResponse.json(result);
  } catch (err) {
    if (isInsufficientCredits(err)) return insufficientCreditsResponse(err);
    if (err instanceof CitationReasoningDisabledError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    logger.error(
      { event: "citation_reasoning_request_failed", err: String(err) },
      "citation reasoning request failed",
    );
    return NextResponse.json({ error: "Failed to generate reasoning" }, { status: 500 });
  }
}
