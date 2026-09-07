import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const getCitationEnrichmentByDoiMock = vi.fn();
vi.mock("@/lib/ai/citations/enrichment", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ai/citations/enrichment")>(
    "@/lib/ai/citations/enrichment",
  );
  return {
    ...actual,
    getCitationEnrichmentByDoi: (doi: string) => getCitationEnrichmentByDoiMock(doi),
  };
});

import { GET } from "@/app/api/citations/by-doi/route";

function makeRequest(query: string): NextRequest {
  return new NextRequest(new URL(`http://localhost:3000/api/citations/by-doi?${query}`));
}

describe("GET /api/citations/by-doi", () => {
  beforeEach(() => {
    getCitationEnrichmentByDoiMock.mockReset();
  });

  it("returns 400 when 'doi' is missing", async () => {
    const response = await GET(makeRequest(""));
    expect(response.status).toBe(400);
  });

  it("passes the decoded DOI through and returns the enrichment result", async () => {
    getCitationEnrichmentByDoiMock.mockResolvedValue({
      citing: [],
      cited: [],
      sources: ["opencitations"],
      degraded: true,
    });

    const response = await GET(makeRequest(`doi=${encodeURIComponent("10.1109/iccv.2021.00986")}`));
    expect(response.status).toBe(200);
    expect(getCitationEnrichmentByDoiMock).toHaveBeenCalledWith("10.1109/iccv.2021.00986");
  });

  it("returns 500 (not a crash) for an unexpected error", async () => {
    getCitationEnrichmentByDoiMock.mockRejectedValue(new Error("unexpected"));
    const response = await GET(makeRequest("doi=10.1%2Fabc"));
    expect(response.status).toBe(500);
  });
});
