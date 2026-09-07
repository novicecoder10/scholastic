import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  findBySha: vi.fn(),
  insertDocumentWithChunks: vi.fn(),
  listChunksNeedingEmbedding: vi.fn(),
  saveChunkEmbedding: vi.fn(),
  setStatus: vi.fn(),
  extractPdf: vi.fn(),
  put: vi.fn(),
  del: vi.fn(),
  embed: vi.fn(),
}));

vi.mock("@/lib/documents/repository", async () => {
  const actual = await vi.importActual<typeof import("@/lib/documents/repository")>(
    "@/lib/documents/repository",
  );
  return {
    newDocumentId: actual.newDocumentId,
    findBySha: h.findBySha,
    insertDocumentWithChunks: h.insertDocumentWithChunks,
    listChunksNeedingEmbedding: h.listChunksNeedingEmbedding,
    saveChunkEmbedding: h.saveChunkEmbedding,
    setStatus: h.setStatus,
  };
});

vi.mock("@/lib/pdf/extract", async () => {
  const actual = await vi.importActual<typeof import("@/lib/pdf/extract")>("@/lib/pdf/extract");
  return { ...actual, extractPdf: h.extractPdf };
});

vi.mock("@/lib/storage", () => ({
  getBlobStore: () => ({ put: h.put, delete: h.del, get: vi.fn() }),
}));

vi.mock("@/lib/ai/embeddings", () => ({
  getActiveEmbeddingProvider: () => ({ modelId: "test-model", embed: h.embed }),
}));

import {
  ensureIndexed,
  FileTooLargeError,
  ingestPdf,
  MAX_UPLOAD_BYTES,
} from "@/lib/documents/ingest";
import { NoTextLayerError, NotAPdfError } from "@/lib/pdf/extract";

const PDF = Buffer.from("%PDF-1.7\nbody bytes here", "latin1");

function input(bytes: Uint8Array = PDF) {
  return {
    owner: { kind: "anonymous", sessionId: "sess-1" } as const,
    ownerSessionId: "sess-1",
    filename: "paper.pdf",
    bytes,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.findBySha.mockResolvedValue(null);
  h.insertDocumentWithChunks.mockResolvedValue(undefined);
  h.setStatus.mockResolvedValue(undefined);
  h.put.mockResolvedValue(undefined);
  h.del.mockResolvedValue(undefined);
  h.extractPdf.mockResolvedValue({
    pages: [{ pageNumber: 1, text: "Some extracted text." }],
    pageCount: 1,
    truncated: false,
    title: "A Paper",
  });
});

describe("ingestPdf", () => {
  it("stores, extracts, chunks, and persists as parsed", async () => {
    const record = await ingestPdf(input());

    expect(h.put).toHaveBeenCalledOnce();
    expect(h.insertDocumentWithChunks).toHaveBeenCalledOnce();
    expect(record.status).toBe("parsed");
    expect(record.title).toBe("A Paper");
    expect(record.pageCount).toBe(1);
    expect(record.byteSize).toBe(PDF.byteLength);

    const persisted = h.insertDocumentWithChunks.mock.calls[0][0];
    expect(persisted.chunks.length).toBeGreaterThan(0);
    expect(persisted.ownerSessionId).toBe("sess-1");
  });

  it("mints an unguessable document id used as the storage key", async () => {
    const record = await ingestPdf(input());
    expect(record.documentId).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(h.put.mock.calls[0][0]).toBe(record.documentId);
  });

  it("rejects a file over the size cap before touching storage", async () => {
    const huge = Buffer.alloc(MAX_UPLOAD_BYTES + 1);
    huge.write("%PDF-", "latin1");
    await expect(ingestPdf(input(huge))).rejects.toBeInstanceOf(FileTooLargeError);
    expect(h.put).not.toHaveBeenCalled();
  });

  it("rejects a non-PDF by its bytes, not its filename", async () => {
    await expect(ingestPdf(input(Buffer.from("PK\x03\x04", "latin1")))).rejects.toBeInstanceOf(
      NotAPdfError,
    );
    expect(h.put).not.toHaveBeenCalled();
  });

  it("returns the existing document when the same bytes are uploaded twice", async () => {
    h.findBySha.mockResolvedValue({
      documentId: "existing",
      filename: "paper.pdf",
      byteSize: 10,
      status: "indexed",
      pageCount: 1,
      truncated: false,
      title: null,
      createdAt: new Date(),
    });

    const record = await ingestPdf(input());
    expect(record.documentId).toBe("existing");
    expect(h.put).not.toHaveBeenCalled();
    expect(h.insertDocumentWithChunks).not.toHaveBeenCalled();
  });

  it("persists no row and deletes the blob when extraction fails", async () => {
    h.extractPdf.mockRejectedValue(new NoTextLayerError());

    await expect(ingestPdf(input())).rejects.toBeInstanceOf(NoTextLayerError);
    expect(h.put).toHaveBeenCalledOnce();
    expect(h.del).toHaveBeenCalledWith(h.put.mock.calls[0][0]);
    expect(h.insertDocumentWithChunks).not.toHaveBeenCalled();
  });

  it("deletes the blob when the database insert fails", async () => {
    h.insertDocumentWithChunks.mockRejectedValue(new Error("db down"));

    await expect(ingestPdf(input())).rejects.toThrow("db down");
    expect(h.del).toHaveBeenCalledOnce();
  });

  it("propagates the truncation flag from a capped extraction", async () => {
    h.extractPdf.mockResolvedValue({
      pages: [{ pageNumber: 1, text: "text" }],
      pageCount: 500,
      truncated: true,
      title: null,
    });
    const record = await ingestPdf(input());
    expect(record.truncated).toBe(true);
    expect(record.pageCount).toBe(500);
  });
});

describe("ensureIndexed", () => {
  const pending = [
    { id: 1, chunkIndex: 0, pageStart: 1, pageEnd: 1, content: "a", embedding: null },
    { id: 2, chunkIndex: 1, pageStart: 1, pageEnd: 1, content: "b", embedding: null },
  ];

  it("embeds every pending chunk and marks the document indexed", async () => {
    h.listChunksNeedingEmbedding.mockResolvedValue(pending);
    h.embed.mockResolvedValue([
      [1, 0],
      [0, 1],
    ]);
    h.saveChunkEmbedding.mockResolvedValue(undefined);

    await ensureIndexed("doc1");

    expect(h.saveChunkEmbedding).toHaveBeenCalledTimes(2);
    expect(h.saveChunkEmbedding).toHaveBeenCalledWith(1, [1, 0], "test-model");
    expect(h.setStatus).toHaveBeenLastCalledWith("doc1", "indexed");
  });

  it("marks an already-complete document indexed without embedding anything", async () => {
    h.listChunksNeedingEmbedding.mockResolvedValue([]);
    await ensureIndexed("doc1");
    expect(h.embed).not.toHaveBeenCalled();
    expect(h.setStatus).toHaveBeenCalledWith("doc1", "indexed");
  });

  it("leaves the document at parsed when embedding fails, so the next call resumes", async () => {
    h.listChunksNeedingEmbedding.mockResolvedValue(pending);
    h.embed.mockRejectedValue(new Error("provider down"));

    await expect(ensureIndexed("doc1")).resolves.toBeUndefined();
    expect(h.setStatus).toHaveBeenLastCalledWith("doc1", "parsed");
  });

  it("gives up quietly when the chunk read itself fails", async () => {
    h.listChunksNeedingEmbedding.mockRejectedValue(new Error("db down"));
    await expect(ensureIndexed("doc1")).resolves.toBeUndefined();
    expect(h.setStatus).not.toHaveBeenCalled();
  });
});
