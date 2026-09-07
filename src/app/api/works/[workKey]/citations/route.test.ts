import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const getCitationEnrichmentMock = vi.fn();
vi.mock("@/lib/ai/citations/enrichment", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ai/citations/enrichment")>(
    "@/lib/ai/citations/enrichment",
  );
  return {
    ...actual,
    getCitationEnrichment: (workKey: string) => getCitationEnrichmentMock(workKey),
  };
});

import { GET } from "@/app/api/works/[workKey]/citations/route";
import { WorkNotFoundError } from "@/lib/ai/errors";

function makeRequest(workKey: string) {
  const request = new NextRequest(new URL(`http://localhost:3000/api/works/${workKey}/citations`));
  return { request, context: { params: Promise.resolve({ workKey }) } };
}

describe("GET /api/works/[workKey]/citations", () => {
  beforeEach(() => {
    getCitationEnrichmentMock.mockReset();
  });

  it("returns citation data and passes the workKey through", async () => {
    getCitationEnrichmentMock.mockResolvedValue({
      citing: [{ doi: "10.1/citer", title: "A Citer", year: 2022 }],
      cited: [],
      sources: ["opencitations", "semantic_scholar"],
      degraded: false,
    });

    const { request, context } = makeRequest("doi:abc123");
    const response = await GET(request, context);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.citing).toHaveLength(1);
    expect(body.degraded).toBe(false);
    expect(getCitationEnrichmentMock).toHaveBeenCalledWith("doi:abc123");
  });

  it("returns 404 when the workKey doesn't match any known work", async () => {
    getCitationEnrichmentMock.mockRejectedValue(new WorkNotFoundError("hash:doesnotexist"));

    const { request, context } = makeRequest("hash:doesnotexist");
    const response = await GET(request, context);
    expect(response.status).toBe(404);
  });

  it("returns 500 (not a crash) for an unexpected error", async () => {
    getCitationEnrichmentMock.mockRejectedValue(new Error("unexpected"));

    const { request, context } = makeRequest("doi:abc123");
    const response = await GET(request, context);
    expect(response.status).toBe(500);
  });

  it("reports degraded:true with empty results for a DOI-less work, without erroring", async () => {
    getCitationEnrichmentMock.mockResolvedValue({
      citing: [],
      cited: [],
      sources: [],
      degraded: true,
    });

    const { request, context } = makeRequest("hash:noiwork");
    const response = await GET(request, context);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.degraded).toBe(true);
    expect(body.citing).toEqual([]);
  });
});
