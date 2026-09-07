import { beforeEach, describe, expect, it, vi } from "vitest";

const { listChunks, ensureIndexed, embedQuery, getActiveEmbeddingProvider } = vi.hoisted(() => ({
  listChunks: vi.fn(),
  ensureIndexed: vi.fn(),
  embedQuery: vi.fn(),
  getActiveEmbeddingProvider: vi.fn(() => ({ modelId: "test-model" })),
}));

vi.mock("@/lib/documents/repository", () => ({ listChunks }));
vi.mock("@/lib/documents/ingest", () => ({ ensureIndexed }));
vi.mock("@/lib/ai/embeddings", () => ({ embedQuery, getActiveEmbeddingProvider }));

import { lexicalScore, retrieveChunks, tokenize } from "@/lib/documents/retrieve";

function chunk(index: number, content: string, embedding: number[] | null = null) {
  return {
    id: index + 1,
    chunkIndex: index,
    pageStart: index + 1,
    pageEnd: index + 1,
    content,
    embedding,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  ensureIndexed.mockResolvedValue(undefined);
});

describe("tokenize", () => {
  it("drops stop words and short tokens", () => {
    expect(tokenize("What is the effect of a drug?")).toEqual(["effect", "drug"]);
  });

  it("splits on punctuation and lowercases", () => {
    expect(tokenize("RNA-seq, CRISPR/Cas9!")).toEqual(["rna", "seq", "crispr", "cas9"]);
  });
});

describe("lexicalScore", () => {
  it("scores a chunk containing query terms above one that doesn't", () => {
    const q = tokenize("mitochondrial dysfunction");
    const hit = lexicalScore(q, "We observed mitochondrial dysfunction in every sample.");
    const miss = lexicalScore(q, "The weather in Paris was pleasant that week.");
    expect(hit).toBeGreaterThan(miss);
    expect(miss).toBe(0);
  });

  it("does not let a long chunk win on length alone", () => {
    const q = tokenize("dysfunction");
    const focused = lexicalScore(q, "dysfunction was observed");
    const padded = lexicalScore(q, `dysfunction was observed. ${"filler word here. ".repeat(80)}`);
    expect(focused).toBeGreaterThan(padded);
  });

  it("returns zero for an empty query or empty chunk", () => {
    expect(lexicalScore([], "anything")).toBe(0);
    expect(lexicalScore(tokenize("anything"), "")).toBe(0);
  });
});

describe("retrieveChunks", () => {
  it("returns nothing for a document with no chunks", async () => {
    listChunks.mockResolvedValue([]);
    expect(await retrieveChunks("doc1", "question")).toEqual([]);
    expect(embedQuery).not.toHaveBeenCalled();
  });

  it("ranks by cosine similarity when embeddings exist", async () => {
    listChunks.mockResolvedValue([chunk(0, "unrelated", [0, 1]), chunk(1, "the answer", [1, 0])]);
    embedQuery.mockResolvedValue([1, 0]);

    const results = await retrieveChunks("doc1", "question", 2);
    expect(results.map((r) => r.chunkIndex)).toEqual([1, 0]);
    expect(results[0].lexical).toBe(false);
    expect(results[0].pageStart).toBe(2);
  });

  it("honours topK", async () => {
    listChunks.mockResolvedValue([
      chunk(0, "a", [1, 0]),
      chunk(1, "b", [0.9, 0.1]),
      chunk(2, "c", [0.8, 0.2]),
    ]);
    embedQuery.mockResolvedValue([1, 0]);
    expect(await retrieveChunks("doc1", "q", 2)).toHaveLength(2);
  });

  it("falls back to term overlap when no chunk is embedded yet", async () => {
    listChunks.mockResolvedValue([
      chunk(0, "nothing relevant here"),
      chunk(1, "mitochondrial dysfunction was observed"),
    ]);

    const results = await retrieveChunks("doc1", "mitochondrial dysfunction");
    expect(embedQuery).not.toHaveBeenCalled();
    expect(results).toHaveLength(1);
    expect(results[0].chunkIndex).toBe(1);
    expect(results[0].lexical).toBe(true);
  });

  it("falls back to term overlap when embedding the query fails", async () => {
    listChunks.mockResolvedValue([chunk(0, "mitochondrial dysfunction", [1, 0])]);
    embedQuery.mockRejectedValue(new Error("provider down"));

    const results = await retrieveChunks("doc1", "mitochondrial dysfunction");
    expect(results[0].lexical).toBe(true);
  });

  it("self-heals a partially indexed document without blocking the answer", async () => {
    listChunks.mockResolvedValue([chunk(0, "a", [1, 0]), chunk(1, "b")]);
    embedQuery.mockResolvedValue([1, 0]);

    await retrieveChunks("doc1", "q");
    expect(ensureIndexed).toHaveBeenCalledWith("doc1");
  });

  it("does not re-index a fully indexed document", async () => {
    listChunks.mockResolvedValue([chunk(0, "a", [1, 0])]);
    embedQuery.mockResolvedValue([1, 0]);

    await retrieveChunks("doc1", "q");
    expect(ensureIndexed).not.toHaveBeenCalled();
  });

  it("ranks only over embedded chunks, ignoring unembedded ones", async () => {
    listChunks.mockResolvedValue([chunk(0, "embedded", [1, 0]), chunk(1, "pending")]);
    embedQuery.mockResolvedValue([1, 0]);

    const results = await retrieveChunks("doc1", "q");
    expect(results.map((r) => r.chunkIndex)).toEqual([0]);
  });
});
