import { NextRequest, NextResponse } from "next/server";
import { performSearch } from "@/lib/search";
import type { SearchMode, SearchRequest } from "@/lib/types/search";

function parseIntParam(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function parseModeParam(value: string | null): SearchMode | undefined {
  return value === "semantic" ? "semantic" : undefined;
}

function parseBoolParam(value: string | null): boolean | undefined {
  if (value == null) return undefined;
  return value === "true" || value === "1";
}

/**
 * GET-only by design: every parameter here is a simple key/value filter, and a
 * GET request keeps search results bookmarkable, shareable, and cacheable by
 * intermediaries — properties a POST body would give up for no benefit here.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const q = params.get("q")?.trim();
  if (!q) {
    return NextResponse.json({ error: "Query parameter 'q' is required" }, { status: 400 });
  }

  const sourcesParam = params.get("sources");
  const venuesParam = params.get("venues");

  const searchRequest: SearchRequest = {
    q,
    mode: parseModeParam(params.get("mode")),
    page: parseIntParam(params.get("page")),
    perPage: parseIntParam(params.get("perPage")),
    yearFrom: parseIntParam(params.get("yearFrom")),
    yearTo: parseIntParam(params.get("yearTo")),
    openAccessOnly: parseBoolParam(params.get("openAccessOnly")),
    minCitations: parseIntParam(params.get("minCitations")),
    sources: sourcesParam ? sourcesParam.split(",").filter(Boolean) : undefined,
    venues: venuesParam ? venuesParam.split(",").filter(Boolean) : undefined,
  };

  const response = await performSearch(searchRequest);
  return NextResponse.json(response);
}
