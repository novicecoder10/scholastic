import { createHash } from "node:crypto";
import { getActiveEmbeddingProvider } from "@/lib/ai/embeddings";
import { logger } from "@/lib/log/logger";
import { chunkPages } from "@/lib/pdf/chunk";
import { extractPdf, looksLikePdf, NotAPdfError } from "@/lib/pdf/extract";
import {
  findBySha,
  insertDocumentWithChunks,
  listChunksNeedingEmbedding,
  newDocumentId,
  saveChunkEmbedding,
  setStatus,
  type DocumentRecord,
} from "@/lib/documents/repository";
import { getBlobStore } from "@/lib/storage";
import type { Owner } from "@/lib/auth/owner";

export const MAX_UPLOAD_BYTES = 30 * 1024 * 1024;

export class FileTooLargeError extends Error {
  constructor() {
    super(`That file is larger than ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB.`);
    this.name = "FileTooLargeError";
  }
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export interface IngestInput {
  /** Who the upload belongs to — an account, or the browser (see
   * lib/auth/owner.ts). Both identities are recorded on the row. */
  owner: Owner;
  /** The browser session, always recorded even for a signed-in uploader. */
  ownerSessionId: string;
  filename: string;
  bytes: Uint8Array;
}

/**
 * Phase 1, synchronous: validate, hash, store bytes, extract, chunk, insert.
 * Returns with `status: 'parsed'` and no embeddings — phase 2 fills those in.
 *
 * On any failure after the blob is written, the blob is removed and no row is
 * persisted. That is why `document` has no terminal failure status: a rejected
 * upload leaves no trace at all.
 */
export async function ingestPdf(input: IngestInput): Promise<DocumentRecord> {
  if (input.bytes.byteLength > MAX_UPLOAD_BYTES) throw new FileTooLargeError();
  if (!looksLikePdf(input.bytes)) throw new NotAPdfError();

  // Read before any parsing: see the detachment note in `extractPdf`.
  const byteSize = input.bytes.byteLength;
  const sha256 = sha256Hex(input.bytes);

  // Re-uploading the same paper returns the existing document rather than
  // creating a duplicate the user then has to reconcile by hand.
  const existing = await findBySha(input.owner, sha256);
  if (existing) return existing;

  const documentId = newDocumentId();
  const storageKey = documentId;
  const store = getBlobStore();

  await store.put(storageKey, input.bytes, "application/pdf");

  try {
    const extracted = await extractPdf(input.bytes);
    const chunks = chunkPages(extracted.pages);

    await insertDocumentWithChunks({
      documentId,
      ownerSessionId: input.ownerSessionId,
      userId: input.owner.kind === "user" ? input.owner.userId : null,
      filename: input.filename,
      byteSize,
      sha256,
      storageKey,
      pageCount: extracted.pageCount,
      truncated: extracted.truncated,
      title: extracted.title,
      chunks,
    });

    return {
      documentId,
      filename: input.filename,
      byteSize,
      status: "parsed",
      pageCount: extracted.pageCount,
      truncated: extracted.truncated,
      title: extracted.title,
      createdAt: new Date(),
    };
  } catch (err) {
    await store.delete(storageKey).catch(() => {});
    throw err;
  }
}

/**
 * Phase 2: embed any chunk missing a vector for the active model. Fired
 * un-awaited right after phase 1 so the common case is already warm by the
 * time anyone asks a question, and called again defensively by
 * `retrieveChunks` so a missed or failed run self-heals.
 *
 * A failure deliberately leaves the document at `parsed` rather than marking
 * it broken — the next call simply picks up where this one stopped.
 */
export async function ensureIndexed(documentId: string): Promise<void> {
  const provider = getActiveEmbeddingProvider();

  let pending;
  try {
    pending = await listChunksNeedingEmbedding(documentId, provider.modelId);
  } catch (err) {
    logger.warn(
      { event: "document_index_read_failed", documentId, err: String(err) },
      "could not read chunks needing embedding",
    );
    return;
  }

  if (pending.length === 0) {
    await setStatus(documentId, "indexed").catch(() => {});
    return;
  }

  await setStatus(documentId, "indexing").catch(() => {});

  const BATCH = 32;
  try {
    for (let i = 0; i < pending.length; i += BATCH) {
      const batch = pending.slice(i, i + BATCH);
      const vectors = await provider.embed(batch.map((c) => c.content));
      for (let j = 0; j < batch.length; j++) {
        await saveChunkEmbedding(batch[j].id, vectors[j], provider.modelId);
      }
    }
    await setStatus(documentId, "indexed");
  } catch (err) {
    // Back to 'parsed': partial progress is durable per chunk, so the next
    // call re-reads only what is still missing.
    logger.warn(
      { event: "document_index_failed", documentId, err: String(err) },
      "document embedding failed; will resume on next call",
    );
    await setStatus(documentId, "parsed").catch(() => {});
  }
}
