import { NextRequest, NextResponse } from "next/server";
import { getCitationEnrichment } from "@/lib/ai/citations/enrichment";
import { WorkNotFoundError } from "@/lib/ai/errors";
import { logger } from "@/lib/log/logger";

interface RouteParams {
  params: Promise<{ workKey: string }>;
}

/**
 * GET, unlike /api/works/[workKey]/summary's POST: this only fetches free
 * public citation metadata (no paid LLM call), so it's a cacheable, freely
 * repeatable read — same GET rationale as /api/search.
 */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { workKey } = await params;

  try {
    const result = await getCitationEnrichment(workKey);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof WorkNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    logger.error(
      { event: "citations_request_failed", workKey, err: String(err) },
      "citations request failed",
    );
    return NextResponse.json({ error: "Failed to fetch citation data" }, { status: 500 });
  }
}
