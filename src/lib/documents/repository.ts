import { randomBytes } from "node:crypto";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { document, documentChunk } from "@/lib/db/schema";
import type { Chunk } from "@/lib/pdf/chunk";
import type { Owner } from "@/lib/auth/owner";

export type DocumentStatus = "parsed" | "indexing" | "indexed";

export interface DocumentRecord {
  documentId: string;
  filename: string;
  byteSize: number;
  status: DocumentStatus;
  pageCount: number | null;
  truncated: boolean;
  title: string | null;
  createdAt: Date;
}

/** 24 random bytes: the capability token. Guessing one is the only way in. */
export function newDocumentId(): string {
  return randomBytes(24).toString("base64url");
}

export function toDto(row: typeof document.$inferSelect): DocumentRecord {
  return {
    documentId: row.documentId,
    filename: row.filename,
    byteSize: row.byteSize,
    status: row.status as DocumentStatus,
    pageCount: row.pageCount,
    truncated: row.truncated,
    title: row.title,
    createdAt: row.createdAt,
  };
}

/**
 * The ownership predicate every document lookup shares.
 *
 * A signed-in user owns rows carrying their `userId`. An anonymous browser owns
 * rows carrying its `ownerSessionId` **and no userId** — that second clause
 * matters: without it, a browser whose cookie somehow survived a sign-out would
 * still see the account's documents. `scholastic_sid` is rotated on sign-out
 * precisely so this cannot happen, and this is the belt to that suspenders.
 */
function ownedBy(owner: Owner) {
  return owner.kind === "user"
    ? eq(document.userId, owner.userId)
    : and(eq(document.ownerSessionId, owner.sessionId), isNull(document.userId));
}

export async function findBySha(owner: Owner, sha256: string): Promise<DocumentRecord | null> {
  const [row] = await getDb()
    .select()
    .from(document)
    .where(and(ownedBy(owner), eq(document.sha256, sha256)))
    .limit(1);
  return row ? toDto(row) : null;
}

/**
 * Ownership is enforced by including the session in the WHERE clause rather
 * than fetching and then comparing — a document belonging to someone else is
 * indistinguishable from one that does not exist, which is why every caller
 * can safely answer 404. A 403 would confirm the id is real.
 */
export async function findOwned(
  owner: Owner,
  documentId: string,
): Promise<(DocumentRecord & { storageKey: string }) | null> {
  const [row] = await getDb()
    .select()
    .from(document)
    .where(and(ownedBy(owner), eq(document.documentId, documentId)))
    .limit(1);
  return row ? { ...toDto(row), storageKey: row.storageKey } : null;
}

export async function listOwned(owner: Owner): Promise<DocumentRecord[]> {
  const rows = await getDb()
    .select()
    .from(document)
    .where(ownedBy(owner))
    .orderBy(desc(document.createdAt));
  return rows.map(toDto);
}

export interface InsertDocumentInput {
  documentId: string;
  /** Always recorded, even for a signed-in uploader: it is the browser
   * identity, and dropping it would make the row unreachable if the account is
   * later deleted while the upload is still on disk. */
  ownerSessionId: string;
  /** Set when a signed-in user uploads, so the row never needs adopting. */
  userId: string | null;
  filename: string;
  byteSize: number;
  sha256: string;
  storageKey: string;
  pageCount: number;
  truncated: boolean;
  title: string | null;
  chunks: Chunk[];
}

/** Document row and all its chunks land together, or neither does. */
export async function insertDocumentWithChunks(input: InsertDocumentInput): Promise<void> {
  await getDb().transaction(async (tx) => {
    await tx.insert(document).values({
      documentId: input.documentId,
      ownerSessionId: input.ownerSessionId,
      userId: input.userId,
      filename: input.filename,
      byteSize: input.byteSize,
      sha256: input.sha256,
      storageKey: input.storageKey,
      status: "parsed",
      pageCount: input.pageCount,
      truncated: input.truncated,
      title: input.title,
    });
    if (input.chunks.length > 0) {
      await tx.insert(documentChunk).values(
        input.chunks.map((c) => ({
          documentId: input.documentId,
          chunkIndex: c.chunkIndex,
          pageStart: c.pageStart,
          pageEnd: c.pageEnd,
          content: c.content,
        })),
      );
    }
  });
}

export async function setStatus(documentId: string, status: DocumentStatus): Promise<void> {
  await getDb()
    .update(document)
    .set({ status, updatedAt: new Date() })
    .where(eq(document.documentId, documentId));
}

export interface StoredChunk {
  id: number;
  chunkIndex: number;
  pageStart: number;
  pageEnd: number;
  content: string;
  embedding: number[] | null;
}

export async function listChunks(documentId: string): Promise<StoredChunk[]> {
  return getDb()
    .select({
      id: documentChunk.id,
      chunkIndex: documentChunk.chunkIndex,
      pageStart: documentChunk.pageStart,
      pageEnd: documentChunk.pageEnd,
      content: documentChunk.content,
      embedding: documentChunk.embedding,
    })
    .from(documentChunk)
    .where(eq(documentChunk.documentId, documentId))
    .orderBy(asc(documentChunk.chunkIndex));
}

/**
 * Chunks needing a vector for the *currently active* model. A chunk embedded
 * under a different model counts as missing, for the same reason
 * `work_embedding` is keyed by model: two models' vectors are not comparable,
 * and mixing them corrupts ranking with no visible error.
 */
export async function listChunksNeedingEmbedding(
  documentId: string,
  embeddingModelId: string,
): Promise<StoredChunk[]> {
  return getDb()
    .select({
      id: documentChunk.id,
      chunkIndex: documentChunk.chunkIndex,
      pageStart: documentChunk.pageStart,
      pageEnd: documentChunk.pageEnd,
      content: documentChunk.content,
      embedding: documentChunk.embedding,
    })
    .from(documentChunk)
    .where(
      and(
        eq(documentChunk.documentId, documentId),
        sql`(${documentChunk.embedding} IS NULL OR ${documentChunk.embeddingModelId} IS DISTINCT FROM ${embeddingModelId})`,
      ),
    )
    .orderBy(asc(documentChunk.chunkIndex));
}

export async function saveChunkEmbedding(
  chunkId: number,
  embedding: number[],
  embeddingModelId: string,
): Promise<void> {
  await getDb()
    .update(documentChunk)
    .set({ embedding, embeddingModelId })
    .where(eq(documentChunk.id, chunkId));
}

export async function deleteDocument(owner: Owner, documentId: string): Promise<boolean> {
  const db = getDb();
  return db.transaction(async (tx) => {
    const deleted = await tx
      .delete(document)
      .where(and(ownedBy(owner), eq(document.documentId, documentId)))
      .returning({ documentId: document.documentId });
    if (deleted.length === 0) return false;
    await tx.delete(documentChunk).where(eq(documentChunk.documentId, documentId));
    return true;
  });
}

export { isNull };
