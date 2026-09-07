import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// The underlying business logic (DB read-through cache + Anthropic call) has
// its own unit test (summary.test.ts) and is live-verified manually — this
// route test is only about HTTP wiring: status codes, param extraction, and
// error-type-to-status-code mapping.
const getOrCreateSummaryMock = vi.fn();
vi.mock("@/lib/ai/summary", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ai/summary")>("@/lib/ai/summary");
  return {
    ...actual,
    getOrCreateSummary: (workKey: string) => getOrCreateSummaryMock(workKey),
  };
});

import { POST } from "@/app/api/works/[workKey]/summary/route";
import { SummaryFeatureDisabledError, WorkNotFoundError } from "@/lib/ai/summary";

function makeRequest(workKey: string) {
  const request = new NextRequest(new URL(`http://localhost:3000/api/works/${workKey}/summary`), {
    method: "POST",
  });
  return { request, context: { params: Promise.resolve({ workKey }) } };
}

describe("POST /api/works/[workKey]/summary", () => {
  beforeEach(() => {
    getOrCreateSummaryMock.mockReset();
  });

  it("returns the summary and passes the decoded workKey through", async () => {
    getOrCreateSummaryMock.mockResolvedValue({
      summary: "A plain-language summary.",
      cached: false,
    });

    const { request, context } = makeRequest("doi:abc123");
    const response = await POST(request, context);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body).toEqual({ summary: "A plain-language summary.", cached: false });
    expect(getOrCreateSummaryMock).toHaveBeenCalledWith("doi:abc123");
  });

  it("returns 503 when the feature is disabled (no ANTHROPIC_API_KEY)", async () => {
    getOrCreateSummaryMock.mockRejectedValue(new SummaryFeatureDisabledError());

    const { request, context } = makeRequest("doi:abc123");
    const response = await POST(request, context);
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.error).toMatch(/not configured/i);
  });

  it("returns 404 when the workKey doesn't match any known work", async () => {
    getOrCreateSummaryMock.mockRejectedValue(new WorkNotFoundError("hash:doesnotexist"));

    const { request, context } = makeRequest("hash:doesnotexist");
    const response = await POST(request, context);
    expect(response.status).toBe(404);
  });

  it("returns 500 (not a crash) for an unexpected error, e.g. the Anthropic API failing", async () => {
    getOrCreateSummaryMock.mockRejectedValue(new Error("Anthropic API unreachable"));

    const { request, context } = makeRequest("doi:abc123");
    const response = await POST(request, context);
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toBeTruthy();
  });
});
