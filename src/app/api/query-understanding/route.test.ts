import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const understandQueryMock = vi.fn();
vi.mock("@/lib/ai/queryUnderstanding", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ai/queryUnderstanding")>(
    "@/lib/ai/queryUnderstanding",
  );
  return {
    ...actual,
    understandQuery: (input: string, priorTurns?: unknown) =>
      understandQueryMock(input, priorTurns),
  };
});

import { POST } from "@/app/api/query-understanding/route";

function makeRequest(body: unknown): NextRequest {
  return new NextRequest(new URL("http://localhost:3000/api/query-understanding"), {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

describe("POST /api/query-understanding", () => {
  beforeEach(() => {
    understandQueryMock.mockReset();
  });

  it("returns 400 for invalid JSON", async () => {
    const request = new NextRequest(new URL("http://localhost:3000/api/query-understanding"), {
      method: "POST",
      body: "not json",
      headers: { "Content-Type": "application/json" },
    });
    const response = await POST(request);
    expect(response.status).toBe(400);
  });

  it("returns 400 when 'input' is missing or empty", async () => {
    const response = await POST(makeRequest({ input: "" }));
    expect(response.status).toBe(400);
  });

  it("returns 400 when priorTurns has an invalid shape", async () => {
    const response = await POST(
      makeRequest({ input: "transformers", priorTurns: [{ question: "x" }] }),
    );
    expect(response.status).toBe(400);
  });

  it("returns the understanding result for a valid request", async () => {
    understandQueryMock.mockResolvedValue({
      action: "search",
      query: "transformers",
      mode: "keyword",
    });
    const response = await POST(makeRequest({ input: "transformers" }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ action: "search", query: "transformers", mode: "keyword" });
    expect(understandQueryMock).toHaveBeenCalledWith("transformers", undefined);
  });

  it("passes priorTurns through to understandQuery", async () => {
    understandQueryMock.mockResolvedValue({ action: "clarify", question: "Which field?" });
    const priorTurns = [{ question: "q", answer: "a" }];
    await POST(makeRequest({ input: "transformers", priorTurns }));
    expect(understandQueryMock).toHaveBeenCalledWith("transformers", priorTurns);
  });
});
