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

const buildSynthesisContextMock = vi.fn();
vi.mock("@/lib/ai/synthesisContext", () => ({
  buildSynthesisContext: (query: string, works: unknown) => buildSynthesisContextMock(query, works),
}));

const readOwnerMock = vi.fn();
vi.mock("@/lib/auth/owner", () => ({
  readOwner: () => readOwnerMock(),
}));

const findOwnedMock = vi.fn();
vi.mock("@/lib/documents/repository", () => ({
  findOwned: (owner: unknown, documentId: string) => findOwnedMock(owner, documentId),
}));

const retrieveChunksMock = vi.fn();
vi.mock("@/lib/documents/retrieve", () => ({
  retrieveChunks: (documentId: string, query: string) => retrieveChunksMock(documentId, query),
}));

import { POST } from "@/app/api/chat/route";

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
  let result = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    result += decoder.decode(value, { stream: true });
  }
  return result;
}

function makeRequest(body: unknown): NextRequest {
  return new NextRequest(new URL("http://localhost:3000/api/chat"), {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

describe("POST /api/chat", () => {
  beforeEach(() => {
    getActiveLlmProviderMock.mockReset();
    streamCompleteMock.mockReset();
    buildSynthesisContextMock.mockReset();
    readOwnerMock.mockReset();
    findOwnedMock.mockReset();
    retrieveChunksMock.mockReset();
  });

  it("returns 503 when chat is not configured (no active provider)", async () => {
    getActiveLlmProviderMock.mockReturnValue(null);
    const response = await POST(makeRequest({ messages: [{ role: "user", content: "hi" }] }));
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.error).toMatch(/not configured/i);
  });

  it("returns 400 for an invalid JSON body", async () => {
    getActiveLlmProviderMock.mockReturnValue(fakeProvider());
    const request = new NextRequest(new URL("http://localhost:3000/api/chat"), {
      method: "POST",
      body: "not json",
      headers: { "Content-Type": "application/json" },
    });
    const response = await POST(request);
    expect(response.status).toBe(400);
  });

  it("returns 400 when 'messages' is missing or empty", async () => {
    getActiveLlmProviderMock.mockReturnValue(fakeProvider());
    const response = await POST(makeRequest({ messages: [] }));
    expect(response.status).toBe(400);
  });

  it("returns 400 when a message has an invalid role", async () => {
    getActiveLlmProviderMock.mockReturnValue(fakeProvider());
    const response = await POST(makeRequest({ messages: [{ role: "system", content: "hi" }] }));
    expect(response.status).toBe(400);
  });

  it("streams the assistant's response as plain text chunks, using the provider's capable model", async () => {
    getActiveLlmProviderMock.mockReturnValue(fakeProvider());
    streamCompleteMock.mockReturnValue(asyncChunks(["Hello", " there", "!"]));

    const response = await POST(
      makeRequest({ messages: [{ role: "user", content: "Say hello" }] }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/plain");

    const text = await readAll(response);
    expect(text).toBe("Hello there!");
    expect(streamCompleteMock).toHaveBeenCalledWith(
      expect.objectContaining({ model: "capable-model" }),
    );
  });

  it("passes context through into the system prompt", async () => {
    getActiveLlmProviderMock.mockReturnValue(fakeProvider());
    streamCompleteMock.mockReturnValue(asyncChunks(["ok"]));

    await POST(
      makeRequest({
        messages: [{ role: "user", content: "What is this paper about?" }],
        context: "Title: Attention Is All You Need",
      }),
    );

    expect(streamCompleteMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "capable-model",
        system: expect.stringContaining("Attention Is All You Need"),
      }),
    );
  });

  it("appends an inline error marker (not a crash) when the stream fails mid-flight", async () => {
    getActiveLlmProviderMock.mockReturnValue(fakeProvider());
    streamCompleteMock.mockReturnValue(
      (async function* () {
        yield "partial response";
        throw new Error("upstream interrupted");
      })(),
    );

    const response = await POST(makeRequest({ messages: [{ role: "user", content: "hi" }] }));
    expect(response.status).toBe(200);
    const text = await readAll(response);
    expect(text).toContain("partial response");
    expect(text).toContain("[The response was interrupted");
  });

  it("returns 400 when 'works' has an invalid shape", async () => {
    getActiveLlmProviderMock.mockReturnValue(fakeProvider());
    const response = await POST(
      makeRequest({ messages: [{ role: "user", content: "hi" }], works: [{ workKey: "a" }] }),
    );
    expect(response.status).toBe(400);
  });

  it("builds synthesis context from 'works', ranked by the original (first) message", async () => {
    getActiveLlmProviderMock.mockReturnValue(fakeProvider());
    streamCompleteMock.mockReturnValue(asyncChunks(["ok"]));
    buildSynthesisContextMock.mockResolvedValue("Paper 1: Foo\nAbstract: ...");

    const works = [
      { workKey: "a", title: "Foo", abstract: "..." },
      { workKey: "b", title: "Bar", abstract: null },
    ];
    await POST(
      makeRequest({
        messages: [
          { role: "user", content: "What do these papers agree on?" },
          { role: "assistant", content: "..." },
          { role: "user", content: "follow-up" },
        ],
        works,
      }),
    );

    // Always derives ranking from messages[0], not the latest message.
    expect(buildSynthesisContextMock).toHaveBeenCalledWith("What do these papers agree on?", works);
    expect(streamCompleteMock).toHaveBeenCalledWith(
      expect.objectContaining({ system: expect.stringContaining("Paper 1: Foo") }),
    );
  });

  it("falls back to naive (unranked) context if synthesis ranking fails, rather than erroring", async () => {
    getActiveLlmProviderMock.mockReturnValue(fakeProvider());
    streamCompleteMock.mockReturnValue(asyncChunks(["ok"]));
    buildSynthesisContextMock.mockRejectedValue(new Error("embedding backend down"));

    const works = [{ workKey: "a", title: "Foo Paper", abstract: "An abstract." }];
    const response = await POST(
      makeRequest({ messages: [{ role: "user", content: "question" }], works }),
    );

    expect(response.status).toBe(200);
    expect(streamCompleteMock).toHaveBeenCalledWith(
      expect.objectContaining({ system: expect.stringContaining("Foo Paper") }),
    );
  });

  describe("document chat (documentId)", () => {
    const messages = [
      { role: "user", content: "What is the paper about?" },
      { role: "assistant", content: "It is about X." },
      { role: "user", content: "What sample size did they use?" },
    ];

    function ownedDocument() {
      readOwnerMock.mockResolvedValue({ kind: "anonymous", sessionId: "session-1" });
      findOwnedMock.mockResolvedValue({ documentId: "doc-1", storageKey: "k", filename: "a.pdf" });
    }

    it("rejects documentId combined with another context source", async () => {
      getActiveLlmProviderMock.mockReturnValue(fakeProvider());
      const response = await POST(
        makeRequest({ messages, documentId: "doc-1", context: "Title: X" }),
      );
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toContain("context");
      expect(body.error).toContain("documentId");
      expect(findOwnedMock).not.toHaveBeenCalled();
    });

    it("rejects context combined with works, which used to resolve silently", async () => {
      getActiveLlmProviderMock.mockReturnValue(fakeProvider());
      const response = await POST(makeRequest({ messages, context: "Title: X", works: [] }));
      expect(response.status).toBe(400);
    });

    it("returns 404 when there is no owner at all — no account and no cookie", async () => {
      getActiveLlmProviderMock.mockReturnValue(fakeProvider());
      readOwnerMock.mockResolvedValue(null);
      const response = await POST(makeRequest({ messages, documentId: "doc-1" }));
      expect(response.status).toBe(404);
      expect(findOwnedMock).not.toHaveBeenCalled();
    });

    it("returns 404 (not 403) for a document this session does not own", async () => {
      getActiveLlmProviderMock.mockReturnValue(fakeProvider());
      readOwnerMock.mockResolvedValue({ kind: "anonymous", sessionId: "session-1" });
      findOwnedMock.mockResolvedValue(null);
      const response = await POST(makeRequest({ messages, documentId: "doc-1" }));
      expect(response.status).toBe(404);
    });

    it("ranks retrieval against the LATEST user message, not the first", async () => {
      getActiveLlmProviderMock.mockReturnValue(fakeProvider());
      ownedDocument();
      retrieveChunksMock.mockResolvedValue([]);
      streamCompleteMock.mockReturnValue(asyncChunks(["ok"]));

      await POST(makeRequest({ messages, documentId: "doc-1" }));

      expect(retrieveChunksMock).toHaveBeenCalledWith("doc-1", "What sample size did they use?");
    });

    it("streams an answer built from page-attributed excerpts", async () => {
      getActiveLlmProviderMock.mockReturnValue(fakeProvider());
      ownedDocument();
      retrieveChunksMock.mockResolvedValue([
        {
          chunkIndex: 3,
          pageStart: 7,
          pageEnd: 7,
          content: "n = 240 participants",
          score: 0.9,
          lexical: false,
        },
      ]);
      streamCompleteMock.mockReturnValue(asyncChunks(["240 participants [p. 7]"]));

      const response = await POST(makeRequest({ messages, documentId: "doc-1" }));

      expect(await readAll(response)).toBe("240 participants [p. 7]");
      const { system } = streamCompleteMock.mock.calls[0][0];
      expect(system).toContain("[page 7]\nn = 240 participants");
      expect(system).toContain("[p. 7]");
      expect(system).toContain("don't cover it");
    });

    it("tells the model plainly when retrieval matched nothing", async () => {
      getActiveLlmProviderMock.mockReturnValue(fakeProvider());
      ownedDocument();
      retrieveChunksMock.mockResolvedValue([]);
      streamCompleteMock.mockReturnValue(asyncChunks(["ok"]));

      await POST(makeRequest({ messages, documentId: "doc-1" }));

      const { system } = streamCompleteMock.mock.calls[0][0];
      expect(system).toContain("(no excerpts matched this question)");
    });

    it("answers without excerpts rather than failing when retrieval throws", async () => {
      getActiveLlmProviderMock.mockReturnValue(fakeProvider());
      ownedDocument();
      retrieveChunksMock.mockRejectedValue(new Error("pgvector down"));
      streamCompleteMock.mockReturnValue(asyncChunks(["ok"]));

      const response = await POST(makeRequest({ messages, documentId: "doc-1" }));
      expect(response.status).toBe(200);
      expect(await readAll(response)).toBe("ok");
    });

    it("does not touch the document path for ordinary single-paper chat", async () => {
      getActiveLlmProviderMock.mockReturnValue(fakeProvider());
      streamCompleteMock.mockReturnValue(asyncChunks(["ok"]));

      await POST(makeRequest({ messages, context: "Title: X" }));

      expect(readOwnerMock).not.toHaveBeenCalled();
      const { system } = streamCompleteMock.mock.calls[0][0];
      expect(system).toContain("Title: X");
      expect(system).not.toContain("uploaded");
    });
  });
});
