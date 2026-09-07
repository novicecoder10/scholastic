import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const getActiveLlmProviderMock = vi.fn();
const streamCompleteMock = vi.fn();
vi.mock("@/lib/ai/llm", () => ({
  NO_LLM_PROVIDER_MESSAGE: "no AI provider is configured (test)",
}));

// One seam for provider selection, credit pre-flight and the usage debit.
vi.mock("@/lib/credits/metered", () => ({
  meteredLlm: async () => {
    const provider = getActiveLlmProviderMock();
    return provider ? { provider, onUsage: () => {}, estimate: 1, balance: null } : null;
  },
  InsufficientCreditsError: class extends Error {},
}));

import { POST } from "@/app/api/paraphrase/route";
import { MAX_PARAPHRASE_WORDS } from "@/lib/ai/paraphrase";

function fakeProvider() {
  return {
    models: { cheap: "cheap-model", capable: "capable-model" },
    isConfigured: () => true,
    complete: vi.fn(),
    streamComplete: (...args: unknown[]) => streamCompleteMock(...args),
  };
}

async function* asyncChunks(chunks: string[]) {
  for (const chunk of chunks) yield chunk;
}

async function readAll(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let out = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    out += decoder.decode(value, { stream: true });
  }
  return out;
}

function makeRequest(body: unknown): NextRequest {
  return new NextRequest(new URL("http://localhost:3000/api/paraphrase"), {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

describe("POST /api/paraphrase", () => {
  beforeEach(() => {
    getActiveLlmProviderMock.mockReset();
    streamCompleteMock.mockReset();
  });

  it("returns 503 when no LLM is configured", async () => {
    getActiveLlmProviderMock.mockReturnValue(null);
    const response = await POST(makeRequest({ text: "hi", mode: "concise" }));
    expect(response.status).toBe(503);
  });

  it("returns 400 for an invalid JSON body", async () => {
    getActiveLlmProviderMock.mockReturnValue(fakeProvider());
    const request = new NextRequest(new URL("http://localhost:3000/api/paraphrase"), {
      method: "POST",
      body: "not json",
      headers: { "Content-Type": "application/json" },
    });
    expect((await POST(request)).status).toBe(400);
  });

  it("requires non-empty text", async () => {
    getActiveLlmProviderMock.mockReturnValue(fakeProvider());
    expect((await POST(makeRequest({ text: "   ", mode: "concise" }))).status).toBe(400);
  });

  it("rejects an unknown mode", async () => {
    getActiveLlmProviderMock.mockReturnValue(fakeProvider());
    const response = await POST(makeRequest({ text: "hi", mode: "spicy" }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("plain-language");
  });

  it("rejects text over the word cap, naming the limit", async () => {
    getActiveLlmProviderMock.mockReturnValue(fakeProvider());
    const text = Array.from({ length: MAX_PARAPHRASE_WORDS + 1 }, () => "word").join(" ");
    const response = await POST(makeRequest({ text, mode: "concise" }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain(String(MAX_PARAPHRASE_WORDS));
    expect(streamCompleteMock).not.toHaveBeenCalled();
  });

  it("accepts text exactly at the cap", async () => {
    getActiveLlmProviderMock.mockReturnValue(fakeProvider());
    streamCompleteMock.mockReturnValue(asyncChunks(["ok"]));
    const text = Array.from({ length: MAX_PARAPHRASE_WORDS }, () => "word").join(" ");
    expect((await POST(makeRequest({ text, mode: "concise" }))).status).toBe(200);
  });

  it("streams the rewrite as plain text", async () => {
    getActiveLlmProviderMock.mockReturnValue(fakeProvider());
    streamCompleteMock.mockReturnValue(asyncChunks(["The ", "rewritten ", "text."]));
    const response = await POST(makeRequest({ text: "Draft.", mode: "plain-language" }));
    expect(response.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
    expect(await readAll(response)).toBe("The rewritten text.");
  });

  it("carries the three correctness constraints into the system prompt", async () => {
    getActiveLlmProviderMock.mockReturnValue(fakeProvider());
    streamCompleteMock.mockReturnValue(asyncChunks(["x"]));
    await POST(makeRequest({ text: "Draft.", mode: "formal" }));

    const { system, messages } = streamCompleteMock.mock.calls[0][0];
    expect(system).toContain("Preserve every citation marker verbatim");
    expect(system).toContain("Add no claims");
    expect(system).toContain("must not become 'shows'");
    expect(system).toContain("formal academic register");
    expect(messages).toEqual([{ role: "user", content: "Draft." }]);
  });

  it("appends an inline marker rather than crashing when the stream fails", async () => {
    getActiveLlmProviderMock.mockReturnValue(fakeProvider());
    streamCompleteMock.mockReturnValue(
      (async function* () {
        yield "Partial";
        throw new Error("upstream died");
      })(),
    );
    expect(await readAll(await POST(makeRequest({ text: "x", mode: "concise" })))).toContain(
      "[The rewrite was interrupted by an error.]",
    );
  });
});
