import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const getCitationReasoningMock = vi.fn();
vi.mock("@/lib/ai/citations/reasoning", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ai/citations/reasoning")>(
    "@/lib/ai/citations/reasoning",
  );
  return {
    ...actual,
    getCitationReasoning: (citingDoi: string, citedDoi: string) =>
      getCitationReasoningMock(citingDoi, citedDoi),
  };
});

import { POST } from "@/app/api/citations/reasoning/route";
import { CitationReasoningDisabledError } from "@/lib/ai/citations/reasoning";

function makeRequest(body: unknown): NextRequest {
  return new NextRequest(new URL("http://localhost:3000/api/citations/reasoning"), {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

describe("POST /api/citations/reasoning", () => {
  beforeEach(() => {
    getCitationReasoningMock.mockReset();
  });

  it("returns 400 for invalid JSON", async () => {
    const request = new NextRequest(new URL("http://localhost:3000/api/citations/reasoning"), {
      method: "POST",
      body: "not json",
      headers: { "Content-Type": "application/json" },
    });
    const response = await POST(request);
    expect(response.status).toBe(400);
  });

  it("returns 400 when citingDoi or citedDoi is missing", async () => {
    const response = await POST(makeRequest({ citingDoi: "10.1/a" }));
    expect(response.status).toBe(400);
  });

  it("returns the reasoning result for a valid request", async () => {
    getCitationReasoningMock.mockResolvedValue({
      reasoning: "Paper B extends Paper A's method.",
      cached: false,
    });
    const response = await POST(makeRequest({ citingDoi: "10.1/b", citedDoi: "10.1/a" }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.reasoning).toBe("Paper B extends Paper A's method.");
    expect(getCitationReasoningMock).toHaveBeenCalledWith("10.1/b", "10.1/a");
  });

  it("returns 503 when citation reasoning is disabled", async () => {
    getCitationReasoningMock.mockRejectedValue(new CitationReasoningDisabledError());
    const response = await POST(makeRequest({ citingDoi: "10.1/b", citedDoi: "10.1/a" }));
    expect(response.status).toBe(503);
  });

  it("returns 500 (not a crash) for an unexpected error", async () => {
    getCitationReasoningMock.mockRejectedValue(new Error("unexpected"));
    const response = await POST(makeRequest({ citingDoi: "10.1/b", citedDoi: "10.1/a" }));
    expect(response.status).toBe(500);
  });
});
