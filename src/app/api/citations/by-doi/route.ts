import { NextRequest, NextResponse } from "next/server";
import { getCitationEnrichmentByDoi } from "@/lib/ai/citations/enrichment";
import { logger } from "@/lib/log/logger";

/**
 * Query param, not a dynamic path segment (`/api/citations/by-doi/[doi]`) — a
 * DOI's `/` becomes `%2F` when encoded, a known source of silent 404s through
 * proxies/CDNs that normalize `%2F`→`/` before Next ever sees the request.
 * `?doi=` sidesteps this entirely and matches `/api/search`'s own idiom.
 *
 * Distinct from `GET /api/works/[workKey]/citations`: that route requires a
 * persisted `work` row (to look up its DOI); this one takes a bare DOI
 * directly, for citation-graph expansion nodes — papers reached only via a
 * citation edge, never searched for and never persisted.
 */
export async function GET(request: NextRequest) {
  const doi = request.nextUrl.searchParams.get("doi")?.trim();
  if (!doi) {
    return NextResponse.json({ error: "Query parameter 'doi' is required" }, { status: 400 });
  }

  try {
    const result = await getCitationEnrichmentByDoi(doi);
    return NextResponse.json(result);
  } catch (err) {
    logger.error(
      { event: "citations_by_doi_request_failed", doi, err: String(err) },
      "citations-by-doi request failed",
    );
    return NextResponse.json({ error: "Failed to fetch citation data" }, { status: 500 });
  }
}
